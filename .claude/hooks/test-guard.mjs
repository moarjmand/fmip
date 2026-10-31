// Runs guard.mjs on every case in guard.cases.json (T-1682): `node .claude/hooks/test-guard.mjs`.
// Run it from the repository root after any change to the guard; it exits 1 on a wrong verdict.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(readFileSync(join(here, 'guard.cases.json'), 'utf8'));
let wrong = 0;
for (const [expected, tool, value] of cases) {
  const key = tool === 'Bash' ? 'command' : 'file_path';
  const run = spawnSync('node', [join(here, 'guard.mjs')], {
    input: JSON.stringify({ tool_name: tool, tool_input: { [key]: value } }),
    encoding: 'utf8',
  });
  const got = run.status === 2 ? 'block' : 'pass';
  if (got !== expected) {
    wrong += 1;
    console.log(`WRONG  expected ${expected}, got ${got}: ${tool} ${value}`);
  }
}
const bad = spawnSync('node', [join(here, 'guard.mjs')], { input: 'not json', encoding: 'utf8' });
if (bad.status !== 0) {
  wrong += 1;
  console.log('WRONG  malformed input must pass');
}
console.log(`${cases.length + 1 - wrong} of ${cases.length + 1} right`);
process.exit(wrong === 0 ? 0 : 1);
