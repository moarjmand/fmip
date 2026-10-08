/**
 * Highlightly's teams paired with ours by matching kick-offs (T-1370, D-188).
 *
 *     docker compose run --rm -v /tmp:/tmp migrate node scripts/highlightly-pairs.mjs
 *     docker compose run --rm -v /tmp:/tmp migrate node scripts/highlightly-pairs.mjs \
 *       --apply strong --from /tmp/highlightly-pairs.json --by admin@example.com
 *
 * Why this exists. The highlights feed (T-1366, D-184) places a clip only
 * when both of its teams are mapped to ours for `highlightly`, and every
 * league brings twenty teams nobody mapped. Placing each one with
 * `catalog.mjs --map` means finding our id for ~400 clubs by hand.
 *
 * What it does. For every competition mapped to a Highlightly league it asks
 * Highlightly for that league's matches over recent and coming days (through
 * the adapter in `@fmip/ingestion`, one request per league and day, under a
 * ceiling stated up front), and lays each beside our matches of the same
 * competition. When exactly one of ours kicks off within 15 minutes of it,
 * and no side already mapped says otherwise, Highlightly's home side is
 * taken as a vote for our home side and its away side for our away side.
 * The votes are counted per Highlightly team: two or more for the same club
 * of ours and none for another is `strong`; one vote, or votes that disagree,
 * is `weak`. A name similarity is printed beside each pair for the reader and
 * is never used to decide anything (rule 1: a name is not a key).
 *
 * What it writes. Nothing, unless asked: the default prints the list and
 * saves it as JSON for review. `--apply strong` writes only the pairs marked
 * strong -- from the reviewed file with `--from`, or from a fresh run --
 * through the same write as `catalog.mjs --map` (`placeMapping`), signed by
 * `--by` and audited. A Highlightly id already mapped is never written over,
 * and a club of ours already mapped to another Highlightly id is refused.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { connectionString, placeMapping, sayIfUnaudited } from './catalog.mjs';

/** How far apart two kick-offs may be and still be the same match. */
export const WINDOW_MINUTES = 15;
/** Agreeing votes a pair needs, with no vote against, to be `strong`. */
export const STRONG_VOTES = 2;
export const DEFAULT_DAYS_BACK = 7;
export const DEFAULT_DAYS_AHEAD = 7;
/** The furthest either way: one request per league and day. */
export const MAX_DAYS = 14;
/**
 * The run's own ceiling, checked before the first request: within the Pro
 * plan's 7,500 a day beside the highlights feed's 5,000 (D-184).
 */
export const DEFAULT_MAX_REQUESTS = 500;
const REQUEST_TIMEOUT_MS = 15_000;
const DEFAULT_OUT = join(tmpdir(), 'highlightly-pairs.json');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EXTERNAL_ID = /^\d+$/;
const EMAIL = /^[^@\s]+@[^@\s]+$/;

const USAGE = `Usage:
  node scripts/highlightly-pairs.mjs [--days-back <n>] [--days-ahead <n>]
      [--competition <uuid>] [--max-requests <n>] [--out <file>]
    Suggests Highlightly team -> our team pairs from matching kick-offs.
    Writes nothing. Prints the list and saves it as JSON (default ${DEFAULT_OUT}).
  node scripts/highlightly-pairs.mjs --apply strong --by <admin e-mail> [--from <file>]
    Writes the strong pairs (from the reviewed file, or from a fresh run), audited.

  --days-back / --days-ahead  days before and after today, UTC (default ${DEFAULT_DAYS_BACK} and ${DEFAULT_DAYS_AHEAD}, at most ${MAX_DAYS})
  --max-requests              refuse a run that would ask more (default ${DEFAULT_MAX_REQUESTS})
  Needs HIGHLIGHTLY_KEY unless --from names a file.`;

const VALUED = [
  'days-back',
  'days-ahead',
  'competition',
  'max-requests',
  'out',
  'apply',
  'from',
  'by',
];

function wholeNumber(text, min, max) {
  if (!/^\d+$/.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

export function parseArgs(argv) {
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') return { error: 'help' };
    if (!arg.startsWith('--')) return { error: `Unexpected argument "${arg}".` };
    const name = arg.slice(2);
    if (!VALUED.includes(name)) return { error: `Unknown option ${arg}.` };
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `${arg} needs a value.` };
    if (options[name] !== undefined) return { error: `${arg} given twice.` };
    options[name] = value;
    i += 1;
  }
  const daysBack = wholeNumber(options['days-back'] ?? String(DEFAULT_DAYS_BACK), 0, MAX_DAYS);
  const daysAhead = wholeNumber(options['days-ahead'] ?? String(DEFAULT_DAYS_AHEAD), 0, MAX_DAYS);
  if (daysBack === null || daysAhead === null) {
    return { error: `--days-back and --days-ahead are whole numbers from 0 to ${MAX_DAYS}.` };
  }
  const maxRequests = wholeNumber(
    options['max-requests'] ?? String(DEFAULT_MAX_REQUESTS),
    1,
    100_000,
  );
  if (maxRequests === null) return { error: '--max-requests is a positive whole number.' };
  if (options.competition !== undefined && !UUID.test(options.competition)) {
    return { error: '--competition is our competition id (a uuid), never a name.' };
  }
  if (options.apply !== undefined && options.apply !== 'strong') {
    return {
      error: '--apply takes only "strong": a weak pair is placed by hand with catalog.mjs --map.',
    };
  }
  if (options.apply === undefined && (options.from !== undefined || options.by !== undefined)) {
    return { error: '--from and --by belong to --apply strong; without it nothing is written.' };
  }
  if (options.apply !== undefined) {
    if (options.by === undefined) {
      return { error: '--by is required with --apply: every pair written is audited.' };
    }
    if (!EMAIL.test(options.by)) return { error: "--by is an administrator's e-mail address." };
  }
  return {
    command: options.apply === undefined ? 'suggest' : 'apply',
    daysBack,
    daysAhead,
    maxRequests,
    competition: options.competition,
    out: options.out ?? DEFAULT_OUT,
    from: options.from,
    by: options.by,
  };
}

// ---------------------------------------------------------------------------
// Names: shown beside a pair, never used to make one
// ---------------------------------------------------------------------------

const NOISE = new Set(['fc', 'cf', 'afc', 'cfc', 'sc', 'ac', 'fk', 'sk', 'club', 'football']);

/** Lower case, accents and punctuation gone, "FC"/"CF" and the like dropped. */
export function normaliseName(name) {
  return String(name)
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/\./g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((word) => word !== '' && !NOISE.has(word))
    .join(' ');
}

function bigrams(text) {
  const compact = text.replace(/ /g, '');
  const grams = new Map();
  for (let i = 0; i < compact.length - 1; i += 1) {
    const gram = compact.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

/** Dice similarity of the normalised names' letter pairs, 0 to 1, two decimals. */
export function nameSimilarity(a, b) {
  const x = normaliseName(a);
  const y = normaliseName(b);
  if (x === '' || y === '') return 0;
  if (x === y) return 1;
  const gx = bigrams(x);
  const gy = bigrams(y);
  let shared = 0;
  let total = 0;
  for (const n of gx.values()) total += n;
  for (const [gram, n] of gy) {
    total += n;
    shared += Math.min(n, gx.get(gram) ?? 0);
  }
  return total === 0 ? 0 : Math.round(((2 * shared) / total) * 100) / 100;
}

// ---------------------------------------------------------------------------
// Votes
// ---------------------------------------------------------------------------

/**
 * Our matches a Highlightly match may be: the same competition, a kick-off
 * within the window, and no side Highlightly already mapped pointing at a
 * club that is not on that side of ours.
 */
export function fitsOf(match, fixtures, mappedHl, windowMinutes = WINDOW_MINUTES) {
  const at = Date.parse(match.kickoffAt);
  const window = windowMinutes * 60_000;
  const sideOk = (hl, ours) =>
    !mappedHl.has(hl.externalId) || mappedHl.get(hl.externalId) === ours.teamId;
  return fixtures.filter(
    (f) =>
      f.competitionId === match.competitionId &&
      Math.abs(new Date(f.kickoffAt).getTime() - at) <= window &&
      sideOk(match.home, f.home) &&
      sideOk(match.away, f.away),
  );
}

const STRENGTH_ORDER = { strong: 0, weak: 1, refused: 2 };

/**
 * The pairs the kick-offs suggest.
 *
 * `matches`: Highlightly's, `{ competitionId, kickoffAt, home, away }` with
 * `home`/`away` as `{ externalId, name }`. `fixtures`: ours, `{ fixtureId,
 * competitionId, kickoffAt, home, away }` with `{ teamId, name }`.
 * `mappedHl`: Highlightly team id -> our team id, as mapped today.
 * `ourMapped`: our team id -> the Highlightly id it is mapped to.
 */
export function suggestPairs(
  { matches, fixtures, mappedHl, ourMapped },
  windowMinutes = WINDOW_MINUTES,
) {
  const stats = { matches: matches.length, uniqueFit: 0, noFit: 0, ambiguous: 0, alreadyMapped: 0 };
  const votes = new Map(); // hl id -> { name, ours: Map(teamId -> { name, count, fixtures }) }
  const mappedSeen = new Set();
  const vote = (hl, ours, fixtureId) => {
    if (mappedHl.has(hl.externalId)) {
      mappedSeen.add(hl.externalId);
      return;
    }
    const entry = votes.get(hl.externalId) ?? { name: hl.name, ours: new Map() };
    const forOurs = entry.ours.get(ours.teamId) ?? { name: ours.name, count: 0, fixtures: [] };
    forOurs.count += 1;
    forOurs.fixtures.push(fixtureId);
    entry.ours.set(ours.teamId, forOurs);
    votes.set(hl.externalId, entry);
  };
  for (const match of matches) {
    if (match.home.externalId === match.away.externalId) continue;
    const fits = fitsOf(match, fixtures, mappedHl, windowMinutes);
    if (fits.length === 0) {
      stats.noFit += 1;
    } else if (fits.length > 1) {
      stats.ambiguous += 1;
    } else {
      stats.uniqueFit += 1;
      vote(match.home, fits[0].home, fits[0].fixtureId);
      vote(match.away, fits[0].away, fits[0].fixtureId);
    }
  }
  stats.alreadyMapped = mappedSeen.size;

  const rows = [];
  for (const [highlightlyId, entry] of votes) {
    const ranked = [...entry.ours.entries()].sort(
      ([idA, a], [idB, b]) => b.count - a.count || idA.localeCompare(idB),
    );
    const [teamId, top] = ranked[0];
    const conflicts = ranked.slice(1).reduce((sum, [, other]) => sum + other.count, 0);
    rows.push({
      highlightlyId,
      highlightlyName: entry.name,
      teamId,
      teamName: top.name,
      votes: top.count,
      conflicts,
      similarity: nameSimilarity(entry.name, top.name),
      strength: 'weak',
      note: null,
      fixtures: top.fixtures,
    });
  }
  const claims = new Map();
  for (const row of rows) claims.set(row.teamId, (claims.get(row.teamId) ?? 0) + 1);
  for (const row of rows) {
    const mappedTo = ourMapped.get(row.teamId);
    if (mappedTo !== undefined && mappedTo !== row.highlightlyId) {
      row.strength = 'refused';
      row.note = `our team is already mapped to highlightly ${mappedTo}`;
    } else if (claims.get(row.teamId) > 1) {
      row.note = 'another Highlightly team points at the same club';
    } else if (row.conflicts > 0) {
      row.note = 'votes disagree';
    } else if (row.votes < STRONG_VOTES) {
      row.note = 'one match only';
    } else {
      row.strength = 'strong';
    }
  }
  rows.sort(
    (a, b) =>
      STRENGTH_ORDER[a.strength] - STRENGTH_ORDER[b.strength] ||
      b.votes - a.votes ||
      a.highlightlyName.localeCompare(b.highlightlyName),
  );
  return { rows, stats };
}

// ---------------------------------------------------------------------------
// Asking Highlightly
// ---------------------------------------------------------------------------

/** Every UTC day from `daysBack` before `today` to `daysAhead` after it. */
export function dayRange(today, daysBack, daysAhead) {
  const start = Date.parse(`${today}T00:00:00Z`) - daysBack * 86_400_000;
  const days = [];
  for (let i = 0; i <= daysBack + daysAhead; i += 1) {
    days.push(new Date(start + i * 86_400_000).toISOString().slice(0, 10));
  }
  return days;
}

/**
 * Which of our seasons a day falls in, by its dates; else the current one;
 * else none, and that day is not asked about.
 */
export function seasonForDay(seasons, day) {
  const within = seasons.find((s) => s.startDate <= day && day <= s.endDate);
  return within ?? seasons.find((s) => s.isCurrent) ?? null;
}

/**
 * The questions a run will ask: per league, runs of consecutive days in one
 * season, each at most 14 days (the adapter's own limit). One request a day.
 */
export function planRequests(leagues, seasonsByCompetition, days) {
  const calls = [];
  const skipped = [];
  for (const league of leagues) {
    const seasons = seasonsByCompetition.get(league.competitionId) ?? [];
    let current = null;
    for (const day of days) {
      const season = seasonForDay(seasons, day);
      if (season === null) {
        skipped.push({ competitionId: league.competitionId, day });
        current = null;
        continue;
      }
      if (current !== null && current.seasonLabel === season.label && current.days < MAX_DAYS) {
        current.to = day;
        current.days += 1;
      } else {
        current = {
          competitionId: league.competitionId,
          competitionName: league.competitionName,
          competitionExternalId: league.externalId,
          seasonLabel: season.label,
          from: day,
          to: day,
          days: 1,
        };
        calls.push(current);
      }
    }
  }
  const requests = calls.reduce((sum, call) => sum + call.days, 0);
  return { calls, requests, skipped };
}

/**
 * Asks each planned question through the adapter. A refused quota stops the
 * run where it is; any other failure is reported and the next league asked.
 */
export async function collectMatches(adapter, calls) {
  const matches = [];
  const problems = [];
  let requests = 0;
  for (const call of calls) {
    const result = await adapter.listFixtures({
      competitionExternalId: call.competitionExternalId,
      seasonLabel: call.seasonLabel,
      from: call.from,
      to: call.to,
    });
    requests += result.requests;
    if (!result.ok) {
      problems.push(
        `${call.competitionName} ${call.from}..${call.to}: ${result.error.kind} ${result.error.message}`,
      );
      if (result.error.kind === 'quota') return { matches, problems, requests, stopped: true };
      continue;
    }
    for (const fixture of result.data) {
      matches.push({
        competitionId: call.competitionId,
        kickoffAt: fixture.kickoffAt,
        home: fixture.home,
        away: fixture.away,
      });
    }
  }
  return { matches, problems, requests, stopped: false };
}

/** The network as JSON, under the run's own ceiling: past it, a 429 as the budget pattern answers. */
export function ceilingTransport(maxRequests, fetchImpl = fetch) {
  let spent = 0;
  return {
    get spent() {
      return spent;
    },
    async request(url, init = {}) {
      if (spent >= maxRequests) {
        return {
          status: 429,
          body: { message: `this run's ceiling of ${maxRequests} requests is spent` },
          receivedAt: new Date().toISOString(),
        };
      }
      spent += 1;
      const response = await fetchImpl(url, {
        method: init.method ?? 'GET',
        headers: init.headers,
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      const text = await response.text();
      let body = text;
      try {
        body = JSON.parse(text);
      } catch {
        // not JSON; the adapter reports it as malformed
      }
      return { status: response.status, body, receivedAt: new Date().toISOString() };
    },
  };
}

async function highlightlyAdapter(apiKey, transport) {
  const mod = await import('@fmip/ingestion');
  const create = mod.createHighlightlyAdapter ?? mod.default?.createHighlightlyAdapter;
  return create(transport, { apiKey });
}

// ---------------------------------------------------------------------------
// The database
// ---------------------------------------------------------------------------

async function loadLeagues(client, competition) {
  const { rows } = await client.query(
    `SELECT pm.external_id, c.id AS competition_id, c.name
       FROM provider_mapping pm
       JOIN competition c ON c.id = pm.internal_id
      WHERE pm.provider = 'highlightly' AND pm.entity_type = 'competition'
        AND ($1::uuid IS NULL OR c.id = $1::uuid)
      ORDER BY c.name, pm.external_id`,
    [competition ?? null],
  );
  return rows.map((r) => ({
    externalId: r.external_id,
    competitionId: r.competition_id,
    competitionName: r.name,
  }));
}

async function loadSeasons(client, competitionIds) {
  const { rows } = await client.query(
    `SELECT competition_id, label, to_char(start_date, 'YYYY-MM-DD') AS start_date,
            to_char(end_date, 'YYYY-MM-DD') AS end_date, is_current
       FROM season WHERE competition_id = ANY($1::uuid[])
      ORDER BY start_date`,
    [competitionIds],
  );
  const byCompetition = new Map();
  for (const r of rows) {
    const list = byCompetition.get(r.competition_id) ?? [];
    list.push({
      label: r.label,
      startDate: r.start_date,
      endDate: r.end_date,
      isCurrent: r.is_current,
    });
    byCompetition.set(r.competition_id, list);
  }
  return byCompetition;
}

async function loadFixtures(client, competitionIds, from, to) {
  const { rows } = await client.query(
    `SELECT f.id, f.kickoff_at, s.competition_id,
            h.team_id AS home_id, th.name AS home_name,
            a.team_id AS away_id, ta.name AS away_name
       FROM fixture f
       JOIN season s ON s.id = f.season_id
       JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
       JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
       JOIN team th ON th.id = h.team_id
       JOIN team ta ON ta.id = a.team_id
      WHERE s.competition_id = ANY($1::uuid[])
        AND f.kickoff_at >= $2::timestamptz - make_interval(mins => $4)
        AND f.kickoff_at < $3::timestamptz + make_interval(mins => $4)`,
    [competitionIds, from, to, WINDOW_MINUTES],
  );
  return rows.map((r) => ({
    fixtureId: r.id,
    competitionId: r.competition_id,
    kickoffAt: r.kickoff_at.toISOString(),
    home: { teamId: r.home_id, name: r.home_name },
    away: { teamId: r.away_id, name: r.away_name },
  }));
}

/** Highlightly's team mappings, both ways. */
export async function loadTeamMappings(client) {
  const { rows } = await client.query(
    `SELECT external_id, internal_id FROM provider_mapping
      WHERE provider = 'highlightly' AND entity_type = 'team'`,
  );
  const mappedHl = new Map();
  const ourMapped = new Map();
  for (const r of rows) {
    mappedHl.set(r.external_id, r.internal_id);
    ourMapped.set(r.internal_id, r.external_id);
  }
  return { mappedHl, ourMapped };
}

// ---------------------------------------------------------------------------
// Writing the strong pairs
// ---------------------------------------------------------------------------

/**
 * Writes the rows marked strong, each re-checked against the database as it
 * stands: an id already mapped is left alone (refused when to another club),
 * a club of ours already mapped to another Highlightly id is refused, and so
 * is a club that does not exist. One transaction: all of it or none.
 */
export async function applyStrong(client, rows, by) {
  const outcome = { written: [], skipped: [], refused: [], audited: false };
  const strong = rows.filter((row) => row.strength === 'strong');
  await client.query('BEGIN');
  try {
    for (const row of strong) {
      const label = `${row.highlightlyId} ${row.highlightlyName ?? ''}`.trim();
      if (!EXTERNAL_ID.test(String(row.highlightlyId)) || !UUID.test(String(row.teamId))) {
        outcome.refused.push({ row, reason: 'not a Highlightly id and a team uuid' });
        continue;
      }
      const existing = await client.query(
        `SELECT internal_id FROM provider_mapping
          WHERE provider = 'highlightly' AND entity_type = 'team' AND external_id = $1`,
        [row.highlightlyId],
      );
      const current = existing.rows[0]?.internal_id;
      if (current === row.teamId) {
        outcome.skipped.push({ row, reason: 'already mapped to this club' });
        continue;
      }
      if (current !== undefined) {
        outcome.refused.push({ row, reason: `${label} is already mapped to ${current}` });
        continue;
      }
      const team = await client.query('SELECT 1 FROM team WHERE id = $1', [row.teamId]);
      if (team.rows.length === 0) {
        outcome.refused.push({ row, reason: `no team ${row.teamId}` });
        continue;
      }
      const other = await client.query(
        `SELECT external_id FROM provider_mapping
          WHERE provider = 'highlightly' AND entity_type = 'team' AND internal_id = $1
          ORDER BY external_id LIMIT 1`,
        [row.teamId],
      );
      if (other.rows[0] !== undefined) {
        outcome.refused.push({
          row,
          reason: `our team is already mapped to highlightly ${other.rows[0].external_id}`,
        });
        continue;
      }
      const audited = await placeMapping(client, {
        provider: 'highlightly',
        type: 'team',
        externalId: String(row.highlightlyId),
        to: row.teamId,
        by,
        note: `paired by ${row.votes} matching kick-offs, confirmed with --apply strong (T-1370)`,
        reason: 'Highlightly team paired by matching kick-offs (T-1370)',
        evidence: { votes: row.votes, conflicts: row.conflicts, name_similarity: row.similarity },
      });
      outcome.audited = outcome.audited || audited;
      outcome.written.push(row);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  }
  return outcome;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function cell(text, width) {
  const value = String(text ?? '');
  return value.length > width ? `${value.slice(0, width - 1)}~` : value.padEnd(width);
}

export function formatTable(rows) {
  const header = [
    cell('strength', 8),
    cell('highlightly', 11),
    cell('their name', 26),
    cell('our team', 36),
    cell('our name', 26),
    cell('votes', 5),
    cell('against', 7),
    cell('name~', 5),
    'note',
  ].join(' ');
  const lines = rows.map((row) =>
    [
      cell(row.strength, 8),
      cell(row.highlightlyId, 11),
      cell(row.highlightlyName, 26),
      cell(row.teamId, 36),
      cell(row.teamName, 26),
      cell(row.votes, 5),
      cell(row.conflicts, 7),
      cell(row.similarity.toFixed(2), 5),
      row.note ?? '',
    ].join(' '),
  );
  return [header, ...lines].join('\n');
}

async function suggest(client, options, apiKey) {
  const leagues = await loadLeagues(client, options.competition);
  if (leagues.length === 0) {
    console.log(
      options.competition === undefined
        ? 'No competition is mapped to a Highlightly league: map one first with catalog.mjs --map --provider highlightly --type competition.'
        : 'That competition is not mapped to a Highlightly league.',
    );
    return null;
  }
  const competitionIds = leagues.map((l) => l.competitionId);
  const seasons = await loadSeasons(client, competitionIds);
  const today = new Date().toISOString().slice(0, 10);
  const days = dayRange(today, options.daysBack, options.daysAhead);
  const plan = planRequests(leagues, seasons, days);
  if (plan.requests > options.maxRequests) {
    console.error(
      `This run would ask Highlightly ${plan.requests} times (${leagues.length} leagues, ` +
        `${days.length} days), over the ceiling of ${options.maxRequests}. Ask for fewer days, ` +
        'one --competition, or raise --max-requests. Nothing was asked.',
    );
    return undefined;
  }
  console.log(
    `Asking Highlightly about ${leagues.length} league(s), ${days[0]}..${days[days.length - 1]}: ` +
      `${plan.requests} request(s).`,
  );
  const transport = ceilingTransport(options.maxRequests);
  const adapter = await highlightlyAdapter(apiKey, transport);
  const collected = await collectMatches(adapter, plan.calls);
  for (const problem of collected.problems) console.log(`  ! ${problem}`);
  if (collected.stopped)
    console.log('  ! quota refused: the list below is what came back before it.');

  const from = `${days[0]}T00:00:00Z`;
  const to = new Date(Date.parse(`${days[days.length - 1]}T00:00:00Z`) + 86_400_000).toISOString();
  const fixtures = await loadFixtures(client, competitionIds, from, to);
  const mappings = await loadTeamMappings(client);
  const { rows, stats } = suggestPairs({ matches: collected.matches, fixtures, ...mappings });

  console.log(formatTable(rows));
  const count = (s) => rows.filter((r) => r.strength === s).length;
  console.log(
    `\n${stats.matches} Highlightly match(es): ${stats.uniqueFit} with exactly one of ours, ` +
      `${stats.ambiguous} with more than one, ${stats.noFit} with none. ` +
      `${stats.alreadyMapped} team(s) already mapped, skipped. ` +
      `Pairs: ${count('strong')} strong, ${count('weak')} weak, ${count('refused')} refused. ` +
      `${collected.requests} request(s) sent.`,
  );
  const report = {
    generatedAt: new Date().toISOString(),
    from,
    to,
    windowMinutes: WINDOW_MINUTES,
    strongVotes: STRONG_VOTES,
    requests: collected.requests,
    problems: collected.problems,
    stats,
    rows,
  };
  writeFileSync(options.out, `${JSON.stringify(report, null, 2)}\n`);
  console.log(`Saved to ${options.out}.`);
  return rows;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error !== undefined) {
    if (parsed.error === 'help') {
      console.log(USAGE);
      return 0;
    }
    console.error(parsed.error);
    console.error(`\n${USAGE}`);
    return 2;
  }
  const apiKey = (process.env.HIGHLIGHTLY_KEY ?? '').trim();
  const fetching = parsed.from === undefined;
  if (fetching && apiKey === '') {
    console.error(
      'HIGHLIGHTLY_KEY is not set, so Highlightly cannot be asked and nothing was done. ' +
        'Set it in the server .env (the migrate service reads it), or apply a reviewed file with --from.',
    );
    return 2;
  }
  let fileRows;
  if (!fetching) {
    const report = JSON.parse(readFileSync(parsed.from, 'utf8'));
    if (!Array.isArray(report.rows)) {
      console.error(`${parsed.from} has no "rows": not a file this command saved.`);
      return 2;
    }
    fileRows = report.rows;
  }
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    const rows = fetching ? await suggest(client, parsed, apiKey) : fileRows;
    if (rows === undefined) return 2;
    if (rows === null || parsed.command === 'suggest') {
      if (rows !== null) {
        console.log(
          'Nothing written. Review the list, then: --apply strong --from <file> --by <e-mail>.',
        );
      }
      return 0;
    }
    const outcome = await applyStrong(client, rows, parsed.by);
    for (const row of outcome.written) {
      console.log(`highlightly team ${row.highlightlyId} -> ${row.teamId} (${row.votes} votes).`);
    }
    for (const { row, reason } of outcome.skipped) {
      console.log(`  = ${row.highlightlyId}: ${reason}.`);
    }
    for (const { row, reason } of outcome.refused) {
      console.log(`  ! refused ${row.highlightlyId}: ${reason}.`);
    }
    console.log(
      `${outcome.written.length} written, ${outcome.skipped.length} already in place, ` +
        `${outcome.refused.length} refused. Weak pairs are left for catalog.mjs --map.`,
    );
    if (outcome.written.length > 0) sayIfUnaudited(outcome.audited, parsed.by);
    return 0;
  } finally {
    await client.end();
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('highlightly-pairs.mjs')) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
