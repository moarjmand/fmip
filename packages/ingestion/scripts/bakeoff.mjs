#!/usr/bin/env node
/* global process, console */
// Runs the bake-off (T-024) and writes its results table into
// docs/05-data-providers.md between the bake-off markers, plus a JSON copy
// under packages/ingestion/bakeoff/.
//
//     pnpm --filter @fmip/ingestion build
//     node scripts/bakeoff.mjs --recorded            # from the _fixtures recordings, no network
//     API_FOOTBALL_KEY=… FOOTBALL_DATA_ORG_KEY=… HIGHLIGHTLY_KEY=… node scripts/bakeoff.mjs --live
//
// The live plan lives in scripts/plans/bakeoff.mjs. A provider whose key is
// missing is skipped and named in the output rather than silently counted as
// failing.

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const dist = require('../dist/index.js');

const mode = process.argv.includes('--live')
  ? 'live'
  : process.argv.includes('--recorded')
    ? 'recorded'
    : null;
if (mode === null) {
  console.error('usage: node scripts/bakeoff.mjs --live | --recorded');
  process.exit(2);
}

const PROVIDERS = [
  { dir: 'api-football', envKey: 'API_FOOTBALL_KEY', factory: dist.createApiFootballAdapter },
  {
    dir: 'football-data-org',
    envKey: 'FOOTBALL_DATA_ORG_KEY',
    factory: dist.createFootballDataOrgAdapter,
  },
  { dir: 'highlightly', envKey: 'HIGHLIGHTLY_KEY', factory: dist.createHighlightlyAdapter },
];

let result;
if (mode === 'recorded') {
  const fixtures = join(here, '..', 'src', 'adapters', '_fixtures');
  result = await dist.runRecorded(
    PROVIDERS.map((p) => ({
      factory: p.factory,
      scenarios: dist.loadScenarios(join(fixtures, p.dir)),
    })),
    'the recorded scenarios (Premier League 2023/24 opening weekend and final table)',
  );
} else {
  const plan = (await import('./plans/bakeoff.mjs')).default;
  const ready = PROVIDERS.filter((p) => {
    if (process.env[p.envKey]) return true;
    console.error(`skipping ${p.dir}: ${p.envKey} is not set`);
    return false;
  });
  result = await dist.runLive(
    ready.map((p) => ({ factory: p.factory, apiKey: process.env[p.envKey] })),
    plan,
  );
}

const markdown = dist.renderMarkdown(result);
const docPath = join(here, '..', '..', '..', 'docs', '05-data-providers.md');
writeFileSync(docPath, dist.insertResults(readFileSync(docPath, 'utf8'), markdown));

const outDir = join(here, '..', 'bakeoff');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `${result.ranAt.replace(/[:.]/g, '-')}-${mode}.json`);
writeFileSync(outFile, `${JSON.stringify(result, null, 2)}\n`);

for (const s of result.summaries) {
  console.error(
    `${s.displayName}: ${s.ok}/${s.calls} ok, ${s.requests} requests, fixture ${s.completeness.fixture ?? '—'}%, detail ${s.completeness.detail ?? '—'}%`,
  );
}
console.error(
  `${result.disagreements.length} disagreement(s); table written to docs/05-data-providers.md, data to ${outFile}`,
);
