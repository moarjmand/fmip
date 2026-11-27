// Runs guard.mjs on every case in guard.cases.json (T-1682) and team-guard.mjs on every case in
// team-guard.cases.json (T-1885): `node .claude/hooks/test-guard.mjs`.
// Run it from the repository root after any change to either guard; it exits 1 on a wrong verdict.
//
// A guard.cases.json row is [expected, tool, value]: value is the command (Bash) or the file
// path, or a whole tool_input object (a PowerShell call, an Edit with its text).
// A team-guard.cases.json row is { expect, agent, tool, input } with optional `cwd` and
// `scratchpad`: `agent` becomes the hook input's agent_type (null: the field is absent, as for the
// engineering session), `input` is the whole tool_input. In any string, ${REPO}, ${REPO_BASH},
// ${REPO_WIN}, ${TMP}, ${TMP_BASH}, ${TMP_WIN} and ${SCRATCH} are replaced with this machine's
// paths (the main checkout, also when this file runs from a worktree), so the cases hold anywhere.
// ${OPS_REAL} and ${MEMORY_REAL} (each also _BASH and _WIN) are where E:/FMIP/ops and the
// checkout's .claude/agent-memory really land: the private ops repository on a computer with the
// 2026-11-21 junctions, the folders themselves without them (T-1951). ${LINKS} (also _BASH, _WIN)
// is a folder under <temp>/claude/ this file makes for the run, holding three junctions:
// to-controls (the checkout's .claude), to-hooks (its .claude/hooks) and to-plain (a plain folder
// beside them); a case that names it is skipped where no link can be made.
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const slash = (p) => p.replace(/\\/g, '/').replace(/\/+$/, '');
const gitBash = (p) => p.replace(/^([a-zA-Z]):/, (_, d) => `/${d.toLowerCase()}`);
const repo = slash(here).replace(/\/\.claude\/hooks$/, '').replace(/\/\.claude\/worktrees\/[^/]+$/, '');
const tmp = slash(tmpdir());
/** Where a folder really lands, or the path itself where it does not exist. */
const realOr = (p) => {
  try {
    return slash(realpathSync.native(p));
  } catch {
    return p;
  }
};
const PLACES = {
  REPO: repo,
  REPO_BASH: gitBash(repo),
  REPO_WIN: repo.replace(/\//g, '\\'),
  TMP: tmp,
  TMP_BASH: gitBash(tmp),
  TMP_WIN: tmp.replace(/\//g, '\\'),
  SCRATCH: 'D:/claude-scratch/session-1/scratchpad', // a string only; nothing is written there
};
const spell = (name, path) => Object.assign(PLACES, { [name]: path, [`${name}_BASH`]: gitBash(path), [`${name}_WIN`]: path.replace(/\//g, '\\') });
spell('OPS_REAL', realOr('E:/FMIP/ops'));
spell('MEMORY_REAL', realOr(`${repo}/.claude/agent-memory`));

// Real junctions, made here under <temp>/claude/ (a folder a team agent may write in) and taken
// away again one by one, never by a recursive delete, which would follow them.
const links = [];
let linkRoot = null;
try {
  mkdirSync(join(tmpdir(), 'claude'), { recursive: true });
  linkRoot = mkdtempSync(join(tmpdir(), 'claude', 'team-guard-links-'));
  mkdirSync(join(linkRoot, 'plain'));
  for (const [name, target] of [['to-controls', join(repo, '.claude')], ['to-hooks', join(repo, '.claude', 'hooks')], ['to-plain', join(linkRoot, 'plain')]]) {
    symlinkSync(target, join(linkRoot, name), 'junction');
    links.push(join(linkRoot, name));
  }
  spell('LINKS', slash(linkRoot));
} catch (error) {
  console.log(`SKIPPED  the junction cases: no link could be made here (${error.message})`);
}

function place(value) {
  if (typeof value === 'string') return value.replace(/\$\{([A-Z_]+)\}/g, (all, name) => PLACES[name] ?? all);
  if (Array.isArray(value)) return value.map(place);
  if (value !== null && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, place(v)]));
  return value;
}

/** One run of a guard on one hook input: its verdict and what it said. */
function verdict(guard, input) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [join(here, guard)], { stdio: ['pipe', 'ignore', 'pipe'] });
    let said = '';
    // The settings give each hook 60 s (T-1949: a cold start from the external drive took 7 s); a
    // warm run takes about 1 s, so one that takes over 10 s here is still a wrong verdict.
    const late = setTimeout(() => child.kill(), 10000);
    child.stderr.setEncoding('utf8').on('data', (chunk) => (said += chunk));
    child.on('error', (error) => resolve({ got: `did not start (${error.message})`, said }));
    child.on('close', (code) => {
      clearTimeout(late);
      resolve({ got: code === 2 ? 'block' : code === 0 ? 'pass' : code === null ? 'no answer in 10 s' : `exit ${code}`, said });
    });
    child.stdin.on('error', () => {});
    child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
  });
}

const checks = [];
const expect = (expected, guard, input, label) => checks.push({ expected, guard, input, label });

// guard.mjs: the same for every caller.
for (const [expected, tool, value] of JSON.parse(readFileSync(join(here, 'guard.cases.json'), 'utf8'))) {
  const toolInput = typeof value === 'string' ? { [tool === 'Bash' ? 'command' : 'file_path']: value } : value;
  expect(expected, 'guard.mjs', { tool_name: tool, tool_input: toolInput }, `${tool} ${JSON.stringify(value)}`);
}
expect('pass', 'guard.mjs', 'not json', 'malformed input must pass');

// team-guard.mjs: only the sixteen team agents.
let skipped = 0;
for (const c of place(JSON.parse(readFileSync(join(here, 'team-guard.cases.json'), 'utf8')))) {
  if (linkRoot === null && JSON.stringify(c).includes('${LINKS')) {
    skipped++;
    continue;
  }
  const input = { session_id: 'test', hook_event_name: 'PreToolUse', tool_name: c.tool, tool_input: c.input };
  if (c.cwd !== null) input.cwd = c.cwd ?? PLACES.REPO;
  if (c.scratchpad !== null) input.scratchpad_dir = c.scratchpad ?? PLACES.SCRATCH;
  if (c.agent !== null && c.agent !== undefined) input.agent_type = c.agent;
  expect(c.expect, 'team-guard.mjs', input, `${c.agent ?? '(no agent_type)'} ${c.tool} ${JSON.stringify(c.input)}`);
}
// How it fails: open for a caller that is not a team agent, closed for one that is.
expect('pass', 'team-guard.mjs', 'not json', 'malformed input with no team agent named must pass');
expect('pass', 'team-guard.mjs', '', 'empty input must pass');
expect('pass', 'team-guard.mjs', '{"agent_type": "general-purpose", "tool_name": "Bash", "tool_input": {', 'malformed input from a builder must pass');
expect('block', 'team-guard.mjs', '{"agent_type": "qa-engineer", "tool_name": "Bash", "tool_input": {', 'malformed input from a team agent must block');
expect('pass', 'team-guard.mjs', { agent_type: 'qa-engineer', tool_name: 'Bash', tool_input: null }, 'a team agent call with no input has nothing to refuse');
expect('pass', 'team-guard.mjs', { agent_type: 'qa-engineer', tool_name: 'Read', tool_input: { file_path: `${PLACES.REPO}/CLAUDE.md` } }, 'reading is never judged');

// A link on the way: a Write is judged where it lands.
if (linkRoot !== null) {
  const write = (agent, path) => ({ agent_type: agent, tool_name: 'Write', cwd: PLACES.REPO, tool_input: { file_path: slash(join(linkRoot, path)), content: 'x' } });
  expect('block', 'team-guard.mjs', write('qa-engineer', 'to-controls/settings.json'), 'a Write through a junction that lands on .claude/settings.json');
  expect('block', 'team-guard.mjs', write('qa-engineer', 'to-controls/agent-memory/security/x.md'), "a Write through a junction that lands in another agent's memory");
  expect('pass', 'team-guard.mjs', write('qa-engineer', 'to-controls/agent-memory/qa-engineer/x.md'), "a Write through a junction that lands in the agent's own memory");
  expect('pass', 'team-guard.mjs', write('qa-engineer', 'to-plain/x.md'), 'a Write through a junction that stays in the temp folder');
  expect('pass', 'team-guard.mjs', write('qa-engineer', 'plain/x.md'), 'a Write in the temp folder with no link on the way');
}

const wrong = [];
let next = 0;
async function worker() {
  while (next < checks.length) {
    const at = next++;
    const { expected, guard, input, label } = checks[at];
    const { got, said } = await verdict(guard, input);
    // A refusal must name its guard and its reason on stderr: that text is what the agent is shown.
    if (got !== expected) wrong[at] = `WRONG  ${guard}: expected ${expected}, got ${got}: ${label}`;
    else if (got === 'block' && !said.includes(guard)) wrong[at] = `WRONG  ${guard}: blocked without saying why: ${label}`;
  }
}
await Promise.all(Array.from({ length: Math.min(8, availableParallelism()) }, worker));
for (const link of links) {
  try {
    unlinkSync(link);
  } catch {
    rmdirSync(link); // a junction is taken away like an empty folder; its target is untouched
  }
}
if (linkRoot !== null) {
  try {
    rmdirSync(join(linkRoot, 'plain'));
    rmdirSync(linkRoot);
  } catch {
    // left behind in the temp folder: harmless
  }
}

const failures = wrong.filter(Boolean);
for (const line of failures) console.log(line);
const count = (guard) => checks.filter((c) => c.guard === guard).length;
console.log(`guard.mjs: ${count('guard.mjs')} cases; team-guard.mjs: ${count('team-guard.mjs')} cases${skipped > 0 ? ` (${skipped} skipped: no links)` : ''}`);
console.log(`${checks.length - failures.length} of ${checks.length} right`);
process.exit(failures.length === 0 ? 0 : 1);
