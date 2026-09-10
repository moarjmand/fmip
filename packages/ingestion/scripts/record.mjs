#!/usr/bin/env node
/* global process, console, setTimeout */
// Records one provider's contract scenarios from the live API (T-021..T-023).
//
//     pnpm --filter @fmip/ingestion build
//     API_FOOTBALL_KEY=... node scripts/record.mjs api-football
//     API_FOOTBALL_KEY=... node scripts/record.mjs api-football --only=live-by-ids-finished
//
// The plan for a provider (scripts/plans/<provider>.mjs) says which calls to
// make with which arguments. What the provider answers is written as it came,
// and the scenario's expectation is derived from the adapter's own result on
// that answer: ok plus the item count, or the error kind. Nothing is invented;
// a run that fails is recorded as a failing scenario. Recordings land in
// src/adapters/_fixtures/<provider>/ and are then the specification the
// contract check replays.
//
// Keys travel in headers, never in URLs, and the output is scanned for the
// key before it is written; a hit is redacted and reported.

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);

const provider = process.argv[2];
const only = process.argv
  .find((a) => a.startsWith('--only='))
  ?.slice(7)
  .split(',');
if (!provider) {
  console.error(
    'usage: node scripts/record.mjs <provider>   (api-football | football-data-org | highlightly)',
  );
  process.exit(2);
}

const plan = (await import(`./plans/${provider}.mjs`)).default;
const dist = require('../dist/index.js');
const apiKey = process.env[plan.envKey];
if (!apiKey) {
  console.error(`${plan.envKey} is not set; a recording needs a live key`);
  process.exit(2);
}

const outDir = join(here, '..', 'src', 'adapters', '_fixtures', provider);
mkdirSync(outDir, { recursive: true });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const scenarios = plan.scenarios.filter((s) => only === undefined || only.includes(s.name));
for (const [index, scenario] of scenarios.entries()) {
  if (index > 0) await sleep(plan.pauseMs ?? 7000); // stay under the per-minute quota
  const transport = new dist.RecordingTransport();
  const adapter = plan.factory(dist)(transport, { apiKey });
  const recordedAt = new Date().toISOString();
  const result = await adapter[scenario.call](...scenario.args);

  const expect = result.ok
    ? { ok: true, ...(Array.isArray(result.data) ? { minItems: result.data.length } : {}) }
    : { ok: false, errorKind: result.error.kind };

  let json = JSON.stringify(
    {
      name: scenario.name,
      recordedAt,
      call: scenario.call,
      args: scenario.args,
      expect,
      requests: transport.recorded,
    },
    null,
    2,
  );
  if (json.includes(apiKey)) {
    json = json.split(apiKey).join('<redacted>');
    console.error(`WARNING: the key appeared in the recording of ${scenario.name}; redacted`);
  }
  writeFileSync(join(outDir, `${scenario.name}.json`), `${json}\n`);

  const summary = result.ok
    ? `ok, ${Array.isArray(result.data) ? `${result.data.length} items` : 'one item'}`
    : `${result.error.kind}: ${result.error.message}`;
  console.error(
    `${scenario.name}: ${summary} (${result.requests} request${result.requests === 1 ? '' : 's'})`,
  );
}
