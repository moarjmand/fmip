// Validating the Power Index weights against history (T-113).
//
//   pnpm --filter @fmip/api build
//   node apps/api/scripts/power-index-backtest.mjs --division E0
//
// Walks a division's history in order. For every match it measures both teams
// from **only the matches played before that day** -- rest and congestion from
// the stored schedule (T-1111): every training.match row, clubs keyed through
// training.team_alias, as the model's rest input reads it -- and competition
// context from the season's table and stored fixture list (T-1123, D-146),
// combines them under each candidate weight set, and records the index gap against what happened. The
// first half of those observations fits an ordered logistic; the second half,
// which the fit never saw, scores the weights.
//
// The point of the exercise is that it is allowed to say "keep the blueprint's
// numbers", and on a single season that is the answer it should usually give.
// A weight set that wins by a hair on 190 matches has found noise.
//
// Writes the report between the markers in docs/12-power-index.md and the whole
// result to apps/api/backtest/<timestamp>-<division>.json.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import pg from 'pg';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..', '..');
const DIST = join(HERE, '..', 'dist', 'modules', 'forecast', 'internal');

// `pathToFileURL` because Windows absolute paths are not valid ESM specifiers.
const load = (file) => import(pathToFileURL(join(DIST, file)).href);
const { combine } = await load('power-index.js');
const { measure } = await load('power-index-measure.js');
const backtest = await load('power-index-backtest.js');

const START_MARKER = '<!-- backtest:start -->';
const END_MARKER = '<!-- backtest:end -->';
/** Matches to accumulate before the first index is worth measuring. */
const WARMUP_MATCHES = 60;

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? fallback : process.argv[index + 1];
}

const division = arg('division', 'E0');

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('DATABASE_URL is not set.');
  process.exit(1);
}

const client = new pg.Client({ connectionString });
await client.connect();

// A club's key in the schedule: its catalogue id through the bridge (D-080),
// else `<division>:<name>` -- never matched across divisions by name (rule 1).
const KEY = (side) =>
  `coalesce(a${side}.team_id::text, m.division || ':' || m.${side === 'h' ? 'home' : 'away'}_team)`;
const BRIDGE = `LEFT JOIN training.team_alias ah
                 ON ah.division = m.division AND ah.training_name = m.home_team
               LEFT JOIN training.team_alias aa
                 ON aa.division = m.division AND aa.training_name = m.away_team`;

const { rows } = await client.query(
  `SELECT to_char(m.match_date, 'YYYY-MM-DD') AS date, m.season, m.home_team, m.away_team,
          m.home_goals, m.away_goals, m.result, ${KEY('h')} AS home_key, ${KEY('a')} AS away_key
     FROM training.match m ${BRIDGE}
    WHERE m.division = $1
    ORDER BY m.match_date ASC, m.home_team ASC`,
  [division],
);
const { rows: scheduleRows } = await client.query(
  `SELECT ${KEY('h')} AS home, ${KEY('a')} AS away, to_char(m.match_date, 'YYYY-MM-DD') AS date
     FROM training.match m ${BRIDGE}`,
);
await client.end();
const schedule = backtest.scheduleOf(
  scheduleRows.flatMap((row) => [
    { club: row.home, date: row.date },
    { club: row.away, date: row.date },
  ]),
);

if (rows.length < WARMUP_MATCHES * 2) {
  console.error(
    `Only ${rows.length} matches for division ${division}. Load the training store first ` +
      `(pnpm --filter @fmip/model ...), or pass --division for one that is loaded.`,
  );
  process.exit(1);
}

const history = rows.map((row) => ({
  date: row.date,
  season: row.season,
  homeKey: row.home_key,
  awayKey: row.away_key,
  home: row.home_team,
  away: row.away_team,
  homeGoals: row.home_goals,
  awayGoals: row.away_goals,
  result: row.result,
}));

// Walk forward. `before` is the division's matches before this one (the
// components ranked among its teams); rest reads the whole stored schedule, but
// only days strictly before the match's. A club with no earlier stored match has
// no rest value, and its weight is redistributed as the live index does.
const observations = new Map(backtest.CANDIDATE_WEIGHTS.map(({ name }) => [name, []]));
let restMeasured = 0;

// Competition context (T-1123, D-146): each season's stored list, read for
// sides and days only (D-143), and each side's stake as a position among the
// division's sides, from the season's results strictly before the match's day.
// Computed once per (season, day). An incomplete list gives no stake.
const seasonRows = new Map();
for (const m of history) {
  const list = seasonRows.get(m.season) ?? [];
  list.push(m);
  seasonRows.set(m.season, list);
}
const seasonLists = new Map(
  [...seasonRows].map(([season, list]) => [season, backtest.seasonListOf(list)]),
);
const stakeCache = new Map();
const stakesOn = (season, date) => {
  const key = `${season}|${date}`;
  if (!stakeCache.has(key)) {
    stakeCache.set(
      key,
      backtest.stakesBefore(seasonLists.get(season), seasonRows.get(season) ?? [], date),
    );
  }
  return stakeCache.get(key);
};
const contextOf = (stakes, team) => {
  const stake = stakes?.get(team);
  if (stake === undefined) {
    return { value: null, note: "the season's stored list is not a complete double round robin" };
  }
  return {
    value: stake.value,
    state: 'limited',
    note: `${stake.open} of ${stake.rivals} rivals still within reach either way`,
  };
};
let contextMeasured = 0;
let contextLocked = 0;

for (let index = WARMUP_MATCHES; index < history.length; index += 1) {
  const match = history[index];
  const before = history.slice(0, index).filter((m) => m.date < match.date);
  const homeRest = backtest.restBefore(schedule.get(match.homeKey), match.date);
  const awayRest = backtest.restBefore(schedule.get(match.awayKey), match.date);
  if (homeRest.daysSincePrevious !== null && awayRest.daysSincePrevious !== null) {
    restMeasured += 1;
  }

  const stakes = stakesOn(match.season, match.date);
  const homeContext = contextOf(stakes, match.home);
  const awayContext = contextOf(stakes, match.away);
  if (homeContext.value !== null && awayContext.value !== null) {
    contextMeasured += 1;
    if (stakes.get(match.home).open === 0 || stakes.get(match.away).open === 0) contextLocked += 1;
  }

  const home = {
    ...measure({ trainingName: match.home, side: 'home', history: before, rest: homeRest }),
    competition_context: homeContext,
  };
  const away = {
    ...measure({ trainingName: match.away, side: 'away', history: before, rest: awayRest }),
    competition_context: awayContext,
  };

  for (const { name, weights } of backtest.CANDIDATE_WEIGHTS) {
    const h = combine(home, weights);
    const a = combine(away, weights);
    if (h === null || a === null) continue;
    observations.get(name).push({ difference: h.value - a.value, outcome: match.result });
  }
}

const split = new Map();
for (const [name, all] of observations) {
  const half = Math.floor(all.length / 2);
  split.set(name, { train: all.slice(0, half), test: all.slice(half) });
}

const result = backtest.score(division, split);
result.generatedAt = new Date().toISOString();
result.season = `${history[0].date} to ${history[history.length - 1].date}`;
result.warmupMatches = WARMUP_MATCHES;
result.restMeasured = restMeasured;
result.contextMeasured = contextMeasured;
result.contextLocked = contextLocked;
// Nothing read: the context candidates are the published arithmetic, and a
// "+0.0000" would read as a measured absence of effect.
if (contextMeasured === 0) result.contextContribution = null;
result.completeSeasons = [...seasonLists].filter(([, list]) => list.complete).map(([s]) => s);
result.incompleteSeasons = [...seasonLists].filter(([, list]) => !list.complete).map(([s]) => s);
result.bridgedClubs = new Set(
  history.flatMap((m) => [m.homeKey, m.awayKey]).filter((key) => !key.startsWith(`${division}:`)),
).size;

const outDir = join(HERE, '..', 'backtest');
mkdirSync(outDir, { recursive: true });
const stamp = result.generatedAt.replace(/[:.]/g, '-');
writeFileSync(join(outDir, `${stamp}-${division}.json`), JSON.stringify(result, null, 2));

const table = [
  `### Results — ${division}, ${result.season}`,
  '',
  `Written by \`apps/api/scripts/power-index-backtest.mjs\` on ${result.generatedAt}; do not edit by hand.`,
  '',
  `${result.matches} matches measured after a ${result.warmupMatches}-match warm-up, split ${result.trainSize} to fit and ${result.testSize} to score. The season's own outcome frequencies score **${result.baseRateLogLoss.toFixed(4)}** — a weight set that does not beat that has found nothing.`,
  '',
  `Rest and congestion from the stored schedule: both sides' rest was read for ${result.restMeasured} of ${history.length - WARMUP_MATCHES} matches; ${result.bridgedClubs} of the division's clubs are bridged to our records (their cup matches count); the others' schedule is their league matches alone. Travel is not modelled.` +
    (result.restContribution === null
      ? ''
      : ` Removing the rest component changes held-out log-loss by ${result.restContribution >= 0 ? '+' : ''}${result.restContribution.toFixed(4)} (positive: rest helped).`),
  '',
  `Competition context (T-1123) from the season's table and stored fixture list: both sides' stake was read for ${result.contextMeasured} of ${history.length - WARMUP_MATCHES} matches (${result.contextLocked} with a locked side); complete seasons: ${result.completeSeasons.join(', ') || 'none'}; not read (the list is not a complete double round robin): ${result.incompleteSeasons.join(', ') || 'none'}. \`blueprint\` is the published arithmetic, context unmeasured.` +
    (result.contextContribution === null
      ? ''
      : ` Measuring it at 5% (\`with-context\`) changes held-out log-loss by ${result.contextContribution >= 0 ? '+' : ''}${result.contextContribution.toFixed(4)} (positive: context helped).`),
  '',
  '| Weights | Held-out log-loss | Fitted log-loss | Higher index won |',
  '|---|---|---|---|',
  ...result.candidates
    .slice()
    .sort((a, b) => a.testLogLoss - b.testLogLoss)
    .map(
      (candidate) =>
        `| ${candidate.name === result.best ? `**${candidate.name}**` : candidate.name} | ${candidate.testLogLoss.toFixed(4)} | ${candidate.trainLogLoss.toFixed(4)} | ${(candidate.decisiveAccuracy * 100).toFixed(1)}% |`,
    ),
  '',
  `**Verdict.** ${result.verdict}`,
].join('\n');

const docPath = join(ROOT, 'docs', '12-power-index.md');
const doc = readFileSync(docPath, 'utf8');
const start = doc.indexOf(START_MARKER);
const end = doc.indexOf(END_MARKER);
if (start === -1 || end === -1) {
  console.error(`docs/12-power-index.md is missing the ${START_MARKER} / ${END_MARKER} markers.`);
  process.exit(1);
}
writeFileSync(
  docPath,
  `${doc.slice(0, start + START_MARKER.length)}\n${table}\n${doc.slice(end)}`,
  'utf8',
);

console.log(table);
console.log(`\nFull result: apps/api/backtest/${stamp}-${division}.json`);
