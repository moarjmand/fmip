// The first-load JavaScript budgets (T-808), checked against the build in
// `.next`. Run after `next build`; exits 1 when a route is over its budget,
// naming the route and the numbers.
//
//   pnpm --filter @fmip/web perf:bundle
//
// What is measured and why: `scripts/lib/perf-budgets.mjs`. The budgets and
// how to raise one: `perf-budgets.json`, `docs/08-load-test.md` "Page budgets".

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compareFirstLoadJs, measureFirstLoadJs, readBudgets } from './lib/perf-budgets.mjs';

const WEB = join(dirname(fileURLToPath(import.meta.url)), '..');
const nextDir = join(WEB, '.next');

const { lines, failures } = compareFirstLoadJs(
  readBudgets(join(WEB, 'perf-budgets.json')),
  (appRoute) => measureFirstLoadJs(nextDir, appRoute),
);
for (const line of lines) process.stdout.write(`${line}\n`);
if (failures.length > 0) {
  console.error(
    `\n${failures.length} route(s) over the first-load JavaScript budget:\n` +
      failures.map((line) => `  ${line}`).join('\n') +
      '\n\nShrink the page, or raise firstLoadJsGzipKB in apps/web/perf-budgets.json with the ' +
      'reason (docs/08-load-test.md, "Page budgets").',
  );
  process.exit(1);
}
