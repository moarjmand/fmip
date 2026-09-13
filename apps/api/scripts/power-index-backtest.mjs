// Validating the Power Index weights against history (T-113).
//
//   pnpm --filter @fmip/api build
//   node apps/api/scripts/power-index-backtest.mjs --division E0
//
// Walks a division's season in order. For every match it measures both teams
// from **only the matches played before that day**, combines them under each
// candidate weight set, and records the index gap against what happened. The
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

const { rows } = await client.query(
  `SELECT match_date, home_team, away_team, home_goals, away_goals, result
     FROM training.match
    WHERE division = $1
    ORDER BY match_date ASC, home_team ASC`,
  [division],
);
await client.end();

if (rows.length < WARMUP_MATCHES * 2) {
  console.error(
    `Only ${rows.length} matches for division ${division}. Load the training store first ` +
      `(pnpm --filter @fmip/model ...), or pass --division for one that is loaded.`,
  );
  process.exit(1);
}

const history = rows.map((row) => ({
  date: row.match_date.toISOString().slice(0, 10),
  home: row.home_team,
  away: row.away_team,
  homeGoals: row.home_goals,
  awayGoals: row.away_goals,
  result: row.result,
}));

// Walk forward. Rest is not part of this: the training store holds no schedule,
// and inventing one would be measuring the wrong thing — so every candidate is
// scored on the components the history actually supports, equally.
const observations = new Map(backtest.CANDIDATE_WEIGHTS.map(({ name }) => [name, []]));
const noRest = { daysSincePrevious: null, matchesInWindow: 0 };

for (let index = WARMUP_MATCHES; index < history.length; index += 1) {
  const match = history[index];
  const before = history.slice(0, index);

  const home = measure({ trainingName: match.home, side: 'home', history: before, rest: noRest });
  const away = measure({ trainingName: match.away, side: 'away', history: before, rest: noRest });

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
