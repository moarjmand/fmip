/**
 * The editorial desk's watch listings, from a terminal (T-1360, D-181).
 *
 *     docker compose run --rm -T migrate node scripts/viewing.mjs --list-defaults
 *     docker compose run --rm -T migrate node scripts/viewing.mjs --set-default \
 *       --competition 39 --territory IR --broadcaster <uuid> --access free \
 *       --url https://example.test/live --note "the published schedule" --by you@your-domain
 *
 * Why this exists. The console's desk needs a browser session; the
 * maintainer's agent works on the server. This writes the same rows the
 * console writes -- coverage, broadcasters, defaults -- with the same audit
 * rows (rule 10), under an account that holds `admin` or `editor`. Every
 * write needs `--by`; `--dry-run` does the work in a transaction and rolls
 * it back, so it prints exactly what would happen and keeps nothing.
 *
 * What it will not do. It never names a competition by its name (rule 1):
 * `--competition` is the api_football id (through `provider_mapping`) or our
 * uuid. It never lists a single match: defaults list them, and applying is
 * the database's own function `viewing_apply_defaults`, the one copy of the
 * rule the API's hourly job also calls. A listing is always the desk's,
 * link-only (D-069).
 */

import { readFileSync } from 'node:fs';
import pg from 'pg';

/** The editorial desk, fixed by the T-313 migration. */
export const EDITORIAL_SOURCE = '00000000-0000-4000-8000-000000000901';
/** Mirrors `broadcaster_kind_check`, `viewing_option_access_check`, the coverage checks. */
export const BROADCASTER_KINDS = ['tv', 'streaming', 'radio'];
export const ACCESS = ['free', 'registration', 'subscription', 'pay_per_view'];
export const MODULES = ['viewing', 'highlights'];
export const STATES = ['available', 'limited', 'not_supplied'];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_URL = /^https?:\/\/\S+$/;
const TERRITORY = /^[A-Z]{2}$/;

const VERBS = [
  'add-broadcaster',
  'list-broadcasters',
  'declare',
  'set-default',
  'remove-default',
  'list-defaults',
  'upcoming',
  'list',
];
const SWITCHES = [...VERBS, 'dry-run'];
const VALUED = [
  'name',
  'kind',
  'homepage',
  'competition',
  'territory',
  'module',
  'state',
  'note',
  'broadcaster',
  'access',
  'url',
  'id',
  'reason',
  'by',
  'fixture',
  'days',
];
const WRITES = ['add-broadcaster', 'declare', 'set-default', 'remove-default', 'list'];

const USAGE = `Usage (one verb per call; every write takes --by <e-mail of an admin or editor>):
  --list-broadcasters
  --add-broadcaster --name "<name>" --kind <${BROADCASTER_KINDS.join('|')}> [--homepage <url>]
  --declare --competition <api_football id or uuid> --territory <XX>
            --module <${MODULES.join('|')}> --state <${STATES.join('|')}> --note "<schedule>"
  --set-default --competition <api_football id or uuid> --territory <XX> --broadcaster <uuid>
                --access <${ACCESS.join('|')}> --url <official page> --note "<schedule>"
  --remove-default --id <default uuid> --reason "<why>"
  --list-defaults [--competition <..>] [--territory <XX>]
  --upcoming --competition <api_football id or uuid> --territory <XX> [--days <1..21, default 2>]
  --list --fixture <api_football id or uuid> --territory <XX> --broadcaster <uuid>
         --access <${ACCESS.join('|')}> --url <official page> --note "<schedule>"
  Add --dry-run to any write to see what it would do and keep nothing.`;

/**
 * The command in these arguments, or the reason there is none. Pure, so every
 * refusal is tested without a database.
 */
export function parseArgs(argv) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) return { error: `Unexpected argument: ${arg}` };
    const name = arg.slice(2);
    if (!SWITCHES.includes(name) && !VALUED.includes(name)) {
      return { error: `Unknown option: --${name}` };
    }
    if (SWITCHES.includes(name)) {
      flags.set(name, true);
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) return { error: `--${name} needs a value.` };
    flags.set(name, value);
    i += 1;
  }

  const chosen = VERBS.filter((verb) => flags.get(verb) === true);
  if (chosen.length === 0) return { error: 'Name one verb.' };
  if (chosen.length > 1) return { error: `One verb at a time; got ${chosen.join(' and ')}.` };
  const verb = chosen[0];
  const text = (key) => (flags.get(key) ?? '').trim();
  const dryRun = flags.get('dry-run') === true;
  const by = text('by');
  if (WRITES.includes(verb) && by === '') {
    return { error: '--by is required: the admin or editor who signs this is audited.' };
  }
  if (!WRITES.includes(verb) && dryRun) return { error: '--dry-run is for a write.' };
  const territory = text('territory').toUpperCase();

  if (verb === 'list-broadcasters') return { command: verb };
  if (verb === 'list-defaults') {
    if (territory !== '' && !TERRITORY.test(territory)) {
      return { error: '--territory is ISO 3166-1 alpha-2: IR, GB.' };
    }
    return {
      command: verb,
      competition: text('competition') === '' ? null : text('competition'),
      territory: territory === '' ? null : territory,
    };
  }
  if (verb === 'upcoming') {
    const competition = text('competition');
    const days = text('days') === '' ? 2 : Number(text('days'));
    if (competition === '') {
      return { error: '--competition is required: the api_football id or our uuid, never a name.' };
    }
    if (!TERRITORY.test(territory)) return { error: '--territory is ISO 3166-1 alpha-2: IR, GB.' };
    if (!Number.isInteger(days) || days < 1 || days > 21) return { error: '--days is 1 to 21.' };
    return { command: verb, competition, territory, days };
  }
  if (verb === 'list') {
    const fixture = text('fixture');
    const broadcaster = text('broadcaster');
    const access = text('access');
    const url = text('url');
    const note = text('note');
    if (fixture === '') return { error: '--fixture is required: the api_football id or our uuid.' };
    if (!TERRITORY.test(territory)) return { error: '--territory is ISO 3166-1 alpha-2: IR, GB.' };
    if (!UUID.test(broadcaster)) {
      return { error: '--broadcaster is the broadcaster’s uuid (see --list-broadcasters).' };
    }
    if (!ACCESS.includes(access)) return { error: `--access must be one of ${ACCESS.join(', ')}.` };
    if (!HTTP_URL.test(url)) return { error: '--url must be the official http(s) address.' };
    if (note === '')
      return { error: '--note is required: which public schedule this is based on.' };
    return { command: verb, fixture, territory, broadcaster, access, url, note, by, dryRun };
  }
  if (verb === 'add-broadcaster') {
    const name = text('name');
    const kind = text('kind');
    const homepage = text('homepage');
    if (name === '') return { error: '--name is required.' };
    if (!BROADCASTER_KINDS.includes(kind)) {
      return { error: `--kind must be one of ${BROADCASTER_KINDS.join(', ')}.` };
    }
    if (homepage !== '' && !HTTP_URL.test(homepage)) {
      return { error: '--homepage must be an http(s) address.' };
    }
    return { command: verb, name, kind, homepage: homepage === '' ? null : homepage, by, dryRun };
  }
  if (verb === 'remove-default') {
    const id = text('id');
    const reason = text('reason');
    if (!UUID.test(id)) return { error: '--id is the default’s uuid (see --list-defaults).' };
    if (reason === '') return { error: '--reason is required: it is kept in the audit log.' };
    return { command: verb, id, reason, by, dryRun };
  }

  const competition = text('competition');
  const note = text('note');
  if (competition === '') {
    return { error: '--competition is required: the api_football id or our uuid, never a name.' };
  }
  if (!TERRITORY.test(territory)) return { error: '--territory is ISO 3166-1 alpha-2: IR, GB.' };
  if (note === '') return { error: '--note is required: which public schedule this is based on.' };

  if (verb === 'declare') {
    const module = text('module');
    const state = text('state');
    if (!MODULES.includes(module))
      return { error: `--module must be one of ${MODULES.join(', ')}.` };
    if (!STATES.includes(state)) return { error: `--state must be one of ${STATES.join(', ')}.` };
    return { command: verb, competition, territory, module, state, note, by, dryRun };
  }

  const broadcaster = text('broadcaster');
  const access = text('access');
  const url = text('url');
  if (!UUID.test(broadcaster)) {
    return { error: '--broadcaster is the broadcaster’s uuid (see --list-broadcasters).' };
  }
  if (!ACCESS.includes(access)) return { error: `--access must be one of ${ACCESS.join(', ')}.` };
  if (!HTTP_URL.test(url)) return { error: '--url must be the official http(s) address.' };
  return { command: verb, competition, territory, broadcaster, access, url, note, by, dryRun };
}

function connectionString() {
  const file = process.env.DATABASE_URL_FILE;
  if (file !== undefined && file !== '') return readFileSync(file, 'utf8').trim();
  const url = process.env.DATABASE_URL;
  if (url === undefined || url.trim() === '') {
    throw new Error('DATABASE_URL is not set. Run this through `docker compose run --rm migrate`.');
  }
  return url;
}

/** The account that signs a write: it must exist and hold admin or editor. */
async function signer(client, by) {
  const { rows } = await client.query(
    `SELECT u.id FROM user_account u
      WHERE lower(u.email) = lower($1)
        AND EXISTS (SELECT 1 FROM user_role r WHERE r.user_id = u.id AND r.role IN ('admin', 'editor'))`,
    [by],
  );
  if (rows[0] === undefined) throw new Error(`No admin or editor account with the e-mail ${by}.`);
  return rows[0].id;
}

/** The same audit row the API's desk writes for the same act. */
async function audit(client, actorId, action, targetType, targetId, reason, previous, next) {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      actorId,
      action,
      targetType,
      targetId,
      reason,
      previous === null ? null : JSON.stringify(previous),
      JSON.stringify(next),
    ],
  );
}

/** A competition by our uuid or by its api_football id; never by name. */
async function competitionOf(client, given) {
  const { rows } = UUID.test(given)
    ? await client.query(`SELECT id, name FROM competition WHERE id = $1`, [given])
    : await client.query(
        `SELECT c.id, c.name FROM provider_mapping pm JOIN competition c ON c.id = pm.internal_id
          WHERE pm.provider = 'api_football' AND pm.entity_type = 'competition'
            AND pm.external_id = $1`,
        [given],
      );
  if (rows[0] === undefined)
    throw new Error(`No competition ${given} (an api_football id or a uuid).`);
  return rows[0];
}

async function currentSeason(client, competition) {
  const { rows } = await client.query(
    `SELECT id, label FROM season WHERE competition_id = $1 AND is_current`,
    [competition.id],
  );
  if (rows[0] === undefined) throw new Error(`${competition.name} has no current season.`);
  return rows[0];
}

async function listBroadcasters(client) {
  const { rows } = await client.query(
    `SELECT id, name, kind, homepage_url FROM broadcaster ORDER BY name, id`,
  );
  if (rows.length === 0) console.log('No broadcasters yet: --add-broadcaster.');
  for (const r of rows)
    console.log(`${r.id}  ${r.kind.padEnd(9)}  ${r.name}  ${r.homepage_url ?? ''}`);
  return 0;
}

async function addBroadcaster(client, options, actorId) {
  const existing = await client.query(`SELECT id FROM broadcaster WHERE name = $1`, [options.name]);
  if (existing.rows[0] !== undefined) {
    console.log(`${existing.rows[0].id}  (already exists; nothing created)`);
    return 0;
  }
  const { rows } = await client.query(
    `INSERT INTO broadcaster (name, homepage_url, kind) VALUES ($1, $2, $3) RETURNING id`,
    [options.name, options.homepage, options.kind],
  );
  await audit(
    client,
    actorId,
    'broadcaster.create',
    'broadcaster',
    rows[0].id,
    'entered by the editorial desk',
    null,
    {
      name: options.name,
      homepage_url: options.homepage,
      kind: options.kind,
    },
  );
  console.log(rows[0].id);
  return 0;
}

async function declare(client, options, actorId) {
  const competition = await competitionOf(client, options.competition);
  const season = await currentSeason(client, competition);
  const desk = await client.query(
    `SELECT 1 FROM viewing_source WHERE id = $1 AND dropped_at IS NULL`,
    [EDITORIAL_SOURCE],
  );
  if ((desk.rowCount ?? 0) === 0) throw new Error('The editorial desk was dropped as a source.');
  const previous = await client.query(
    `SELECT state, note FROM viewing_coverage
      WHERE season_id = $1 AND territory = $2 AND module = $3 FOR UPDATE`,
    [season.id, options.territory, options.module],
  );
  await client.query(
    `INSERT INTO viewing_coverage (season_id, territory, module, state, source_id, note)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (season_id, territory, module)
     DO UPDATE SET state = EXCLUDED.state, source_id = EXCLUDED.source_id, note = EXCLUDED.note`,
    [
      season.id,
      options.territory,
      options.module,
      options.state,
      options.state === 'not_supplied' ? null : EDITORIAL_SOURCE,
      options.note,
    ],
  );
  const last = previous.rows[0];
  await audit(
    client,
    actorId,
    'viewing.declare',
    'season',
    season.id,
    options.note,
    last === undefined ? null : { state: last.state, note: last.note },
    { territory: options.territory, module: options.module, state: options.state },
  );
  console.log(
    `${competition.name} ${season.label}, ${options.territory}, ${options.module}: ${options.state}` +
      (last === undefined ? '' : ` (was ${last.state})`),
  );
  return 0;
}

async function setDefault(client, options, actorId) {
  const competition = await competitionOf(client, options.competition);
  const season = await currentSeason(client, competition);
  const covered = await client.query(
    `SELECT 1 FROM viewing_coverage
      WHERE season_id = $1 AND territory = $2 AND module = 'viewing'
        AND state IN ('available', 'limited') AND source_id = $3`,
    [season.id, options.territory, EDITORIAL_SOURCE],
  );
  if ((covered.rowCount ?? 0) === 0) {
    throw new Error(
      `${competition.name} ${season.label} is not declared covered for viewing in ${options.territory}: --declare first.`,
    );
  }
  const { rows } = await client.query(
    `INSERT INTO viewing_default
       (competition_id, territory, broadcaster_id, access, url, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [
      competition.id,
      options.territory,
      options.broadcaster,
      options.access,
      options.url,
      options.note,
      actorId,
    ],
  );
  const id = rows[0].id;
  // The database's one copy of the rule; the API's hourly job calls the same function.
  const applied = await client.query(`SELECT created FROM viewing_apply_defaults($1::uuid)`, [id]);
  const created = applied.rows[0]?.created ?? 0;
  await audit(
    client,
    actorId,
    'viewing.default_set',
    'competition',
    competition.id,
    options.note,
    null,
    {
      default_id: id,
      territory: options.territory,
      broadcaster_id: options.broadcaster,
      access: options.access,
      url: options.url,
      applied: created,
    },
  );
  console.log(
    `${id}  ${competition.name} in ${options.territory}: ${created} listing(s) created now.`,
  );
  console.log('The hourly job keeps applying it as new fixtures arrive.');
  return 0;
}

async function removeDefault(client, options, actorId) {
  const { rows } = await client.query(
    `UPDATE viewing_default SET removed_at = now(), removed_reason = $2, removed_by = $3
      WHERE id = $1 AND removed_at IS NULL
      RETURNING competition_id, territory, broadcaster_id, access, url, note`,
    [options.id, options.reason, actorId],
  );
  const gone = rows[0];
  if (gone === undefined) {
    console.error(`No standing default ${options.id}.`);
    return 1;
  }
  const deleted = await client.query(
    `DELETE FROM viewing_option o USING fixture f
      WHERE o.default_id = $1 AND f.id = o.fixture_id AND f.kickoff_at > now()`,
    [options.id],
  );
  await audit(
    client,
    actorId,
    'viewing.default_removed',
    'competition',
    gone.competition_id,
    options.reason,
    {
      default_id: options.id,
      territory: gone.territory,
      broadcaster_id: gone.broadcaster_id,
      access: gone.access,
      url: gone.url,
      note: gone.note,
    },
    { default_id: options.id, removed: true, deleted_listings: deleted.rowCount ?? 0 },
  );
  console.log(
    `Removed. ${deleted.rowCount ?? 0} listing(s) for matches not yet kicked off deleted; past ones kept.`,
  );
  return 0;
}

async function listDefaults(client, options) {
  const competition =
    options.competition === null ? null : (await competitionOf(client, options.competition)).id;
  const { rows } = await client.query(
    `SELECT d.id, c.name AS competition, d.territory, b.name AS broadcaster, d.access, d.url,
            (SELECT count(*)::int FROM viewing_option o WHERE o.default_id = d.id) AS listings
       FROM viewing_default d
       JOIN competition c ON c.id = d.competition_id
       JOIN broadcaster b ON b.id = d.broadcaster_id
      WHERE d.removed_at IS NULL
        AND ($1::uuid IS NULL OR d.competition_id = $1)
        AND ($2::text IS NULL OR d.territory = $2)
      ORDER BY c.name, d.territory, b.name`,
    [competition, options.territory],
  );
  if (rows.length === 0) console.log('No standing defaults.');
  for (const r of rows) {
    console.log(
      `${r.id}  ${r.competition} / ${r.territory}  ${r.broadcaster} (${r.access})  ${r.url}  ${r.listings} listing(s)`,
    );
  }
  return 0;
}

/** A fixture by our uuid or by its api_football id; never by its teams' names. */
async function fixtureOf(client, given) {
  const { rows } = UUID.test(given)
    ? await client.query(`SELECT id, season_id FROM fixture WHERE id = $1`, [given])
    : await client.query(
        `SELECT f.id, f.season_id FROM provider_mapping pm JOIN fixture f ON f.id = pm.internal_id
          WHERE pm.provider = 'api_football' AND pm.entity_type = 'fixture' AND pm.external_id = $1`,
        [given],
      );
  if (rows[0] === undefined) throw new Error(`No fixture ${given} (an api_football id or a uuid).`);
  return rows[0];
}

/**
 * The competition's matches in the next days, as an editor matching a
 * published schedule needs them: the provider id to pass to --list, the
 * kick-off in Tehran and UTC, both sides in Persian where a name row exists,
 * and what is already listed in the territory (T-1362).
 */
async function upcoming(client, options) {
  const competition = await competitionOf(client, options.competition);
  const { rows } = await client.query(
    `SELECT f.id, pm.external_id,
            to_char(f.kickoff_at AT TIME ZONE 'Asia/Tehran', 'YYYY-MM-DD HH24:MI') AS tehran,
            to_char(f.kickoff_at AT TIME ZONE 'UTC', 'HH24:MI') AS utc, f.status,
            coalesce(ah.alias, th.name) AS home, coalesce(aa.alias, ta.name) AS away,
            (SELECT string_agg(b.name || CASE WHEN o.default_id IS NULL THEN '' ELSE ' (default)' END,
                               ', ' ORDER BY b.name)
               FROM viewing_option o JOIN broadcaster b ON b.id = o.broadcaster_id
              WHERE o.fixture_id = f.id AND o.territory = $2) AS listed
       FROM fixture f
       JOIN season s ON s.id = f.season_id AND s.competition_id = $1
       LEFT JOIN provider_mapping pm
         ON pm.internal_id = f.id AND pm.entity_type = 'fixture' AND pm.provider = 'api_football'
       LEFT JOIN fixture_participant ph ON ph.fixture_id = f.id AND ph.side = 'home'
       LEFT JOIN team th ON th.id = ph.team_id
       LEFT JOIN entity_alias ah ON ah.entity_type = 'team' AND ah.entity_id = th.id
                                AND ah.kind = 'name' AND ah.language = 'fa'
       LEFT JOIN fixture_participant pa ON pa.fixture_id = f.id AND pa.side = 'away'
       LEFT JOIN team ta ON ta.id = pa.team_id
       LEFT JOIN entity_alias aa ON aa.entity_type = 'team' AND aa.entity_id = ta.id
                                AND aa.kind = 'name' AND aa.language = 'fa'
      WHERE f.kickoff_at >= now() - interval '3 hours'
        AND f.kickoff_at < now() + make_interval(days => $3)
      ORDER BY f.kickoff_at, f.id`,
    [competition.id, options.territory, options.days],
  );
  if (rows.length === 0)
    console.log(`No ${competition.name} match in the next ${options.days} day(s).`);
  for (const r of rows) {
    console.log(
      `${r.external_id ?? r.id}  ${r.tehran} Tehran (${r.utc} UTC)  ${r.home} – ${r.away}  ${r.status}  listed: ${r.listed ?? 'nothing'}`,
    );
  }
  return 0;
}

/**
 * One match on one service, as the desk's own listing writes it: the season
 * must be covered in the territory, a service already listed for the match is
 * reported and left alone, and the same `viewing.list` audit row (T-1362).
 */
async function list(client, options, actorId) {
  const fixture = await fixtureOf(client, options.fixture);
  const covered = await client.query(
    `SELECT 1 FROM viewing_coverage
      WHERE season_id = $1 AND territory = $2 AND module = 'viewing'
        AND state IN ('available', 'limited') AND source_id = $3`,
    [fixture.season_id, options.territory, EDITORIAL_SOURCE],
  );
  if ((covered.rowCount ?? 0) === 0) {
    throw new Error(
      `This match's season is not declared covered for viewing in ${options.territory}: --declare first.`,
    );
  }
  const { rows } = await client.query(
    `INSERT INTO viewing_option (fixture_id, territory, broadcaster_id, source_id, access, url)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (fixture_id, territory, broadcaster_id) DO NOTHING
     RETURNING id`,
    [
      fixture.id,
      options.territory,
      options.broadcaster,
      EDITORIAL_SOURCE,
      options.access,
      options.url,
    ],
  );
  if (rows[0] === undefined) {
    console.log(
      `${options.fixture}: already listed on that service in ${options.territory}; nothing changed.`,
    );
    return 0;
  }
  await audit(client, actorId, 'viewing.list', 'fixture', fixture.id, options.note, null, {
    option_id: rows[0].id,
    territory: options.territory,
    broadcaster_id: options.broadcaster,
    access: options.access,
    url: options.url,
  });
  console.log(`${rows[0].id}  ${options.fixture} listed in ${options.territory}.`);
  return 0;
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed.error !== undefined) {
    console.error(parsed.error);
    console.error(`\n${USAGE}`);
    return 2;
  }
  const client = new pg.Client({ connectionString: connectionString() });
  await client.connect();
  try {
    if (parsed.command === 'list-broadcasters') return await listBroadcasters(client);
    if (parsed.command === 'list-defaults') return await listDefaults(client, parsed);
    if (parsed.command === 'upcoming') return await upcoming(client, parsed);
    await client.query('BEGIN');
    try {
      const actorId = await signer(client, parsed.by);
      const work = {
        'add-broadcaster': addBroadcaster,
        declare,
        'set-default': setDefault,
        'remove-default': removeDefault,
        list,
      }[parsed.command];
      const code = await work(client, parsed, actorId);
      if (parsed.dryRun || code !== 0) {
        await client.query('ROLLBACK');
        if (parsed.dryRun) console.log('(dry run: nothing kept.)');
      } else {
        await client.query('COMMIT');
      }
      return code;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] !== undefined && process.argv[1].endsWith('viewing.mjs')) {
  main().then(
    (code) => process.exit(code),
    (error) => {
      const failed = /** @type {{ constraint?: string, message?: string }} */ (error);
      if (failed.constraint === 'viewing_default_one_active') {
        console.error(
          'That service is already the default for this competition in this territory.',
        );
      } else {
        console.error(error instanceof Error ? error.message : String(error));
      }
      process.exit(1);
    },
  );
}
