// Runs the five read-only scripts in fixture mode (T-1895): `node .claude/skills/team-charter/bin/test-fixture-mode.mjs`.
// Run it after any change to data-audit/run.sh, ops-check/ops-check.sh, fmip-security/server-hardening.sh,
// product-strategy/seo-check.sh, search-visibility/structured-data.sh or fixture-replay.sh; it exits 1
// on a wrong result. It works the same from Git Bash, PowerShell or cmd.
//
// "No connection" is proved, not assumed. Every run has a PATH whose first folder holds `ssh`, `scp`
// and `curl` stand-ins that write their name to a log and fail, and the shell is Git's own
// usr/bin/bash.exe, never the bin/bash.exe launcher, which puts /usr/bin (the real ssh) in front. Before
// any script runs, that shell must resolve all three to the stand-ins (`command -v`), or the test stops
// with exit 1 having run nothing: a test that could reach the server never starts. With FMIP_FIXTURE
// set the log stays empty; without it (the control) the same stand-ins are reached. Every run sets
// OPS_ROOT to a temp folder but one group, and the three places the scripts write by default
// (E:/FMIP/data-audit/runs, E:/FMIP/ops/reports/ops-release/snapshots, E:/FMIP/ops/sitemap-count.log)
// are compared before and after.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const skills = join(here, '..', '..');
const fwd = (p) => p.replace(/\\/g, '/');

/** name -> the script, by the fixture name it reads (`<name>.txt`, `<name>.exit`). */
const SCRIPTS = {
  run: 'data-audit/run.sh',
  'ops-check': 'ops-check/ops-check.sh',
  'server-hardening': 'fmip-security/server-hardening.sh',
  'seo-check': 'product-strategy/seo-check.sh',
  'structured-data': 'search-visibility/structured-data.sh',
};

let right = 0;
let wrong = 0;
function check(name, ok, detail = '') {
  if (ok) right += 1;
  else {
    wrong += 1;
    console.log(`WRONG  ${name}${detail ? `\n       ${String(detail).replace(/\n/g, '\n       ')}` : ''}`);
  }
}

const root = mkdtempSync(join(tmpdir(), 'fixture-mode-test-'));
const shims = join(root, 'shims');
const log = join(root, 'network.log');
mkdirSync(shims);
// scp "succeeds" so that run.sh's control reaches ssh at once instead of retrying for 30 s
for (const [name, code] of [['ssh', 255], ['scp', 0], ['curl', 7]]) {
  writeFileSync(join(shims, name), `#!/bin/sh\necho "${name} $*" >> "$SHIM_LOG"\nexit ${code}\n`, { mode: 0o755 });
}

/**
 * The shell and the PATH every run gets: the stand-ins first, then Git's own tools (cat, tr, date),
 * then the caller's PATH. On Windows the shell is Git's usr/bin/bash.exe, which keeps PATH as given.
 */
const win = process.platform === 'win32';
const gitRoot = fwd(process.env.EXEPATH ? dirname(process.env.EXEPATH) : 'C:/Program Files/Git');
const bash = win ? `${gitRoot}/usr/bin/bash.exe` : 'bash';
if (win && !existsSync(bash)) {
  console.log(`STOPPED  ${bash} is not there: no shell that keeps the stand-ins first, so nothing was run`);
  process.exit(1);
}
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
const sep = win ? ';' : ':';
const PATH = [shims, ...(win ? [`${gitRoot}/usr/bin`, `${gitRoot}/mingw64/bin`] : []), process.env[pathKey]].join(sep);
function baseEnv(more = {}) {
  const env = { ...process.env, [pathKey]: PATH, SHIM_LOG: fwd(log), MSYSTEM: 'MINGW64', ...more };
  for (const key of ['BASH_ENV', 'ENV', 'FMIP_FIXTURE', 'FMIP_FIXTURE_OK', 'AUDIT_OUT', 'OPS_OUT', 'OPS_ROOT']) {
    if (!(key in more)) delete env[key];
  }
  return env;
}

// The stand-ins must be what this shell finds, or nothing runs.
{
  const probe = spawnSync(
    bash,
    ['-c', 'd="$(cd "$1" && pwd)"; for p in ssh scp curl; do w="$(command -v "$p")"; [ "$w" = "$d/$p" ] || { echo "$p resolves to ${w:-nothing}, not $d/$p"; exit 1; }; done', 'probe', fwd(shims)],
    { encoding: 'utf8', env: baseEnv(), timeout: 30_000 },
  );
  if (probe.status !== 0) {
    console.log(`STOPPED  the stand-ins are not first for ${bash}: ${(probe.stdout + probe.stderr).trim() || probe.error?.message}; nothing was run`);
    process.exit(1);
  }
}

function run(name, { fixture, ok = true, opsRoot, more = {}, args = [] } = {}) {
  const env = baseEnv(more);
  if (opsRoot !== null) env.OPS_ROOT = fwd(opsRoot ?? join(root, 'ops-default'));
  if (fixture !== undefined) env.FMIP_FIXTURE = fwd(fixture);
  if (fixture !== undefined && ok) env.FMIP_FIXTURE_OK = '1';
  writeFileSync(log, '');
  const r = spawnSync(bash, [fwd(join(skills, SCRIPTS[name])), ...args], { encoding: 'utf8', env, timeout: 60_000 });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', net: readFileSync(log, 'utf8') };
}

let n = 0;
function fixtureDir(files) {
  const dir = join(root, `fx-${(n += 1)}`);
  mkdirSync(dir);
  for (const [file, text] of Object.entries(files)) writeFileSync(join(dir, file), text);
  return dir;
}
const filesIn = (dir) => (existsSync(dir) ? readdirSync(dir) : []);
const banner = (dir) => `FIXTURE REPLAY from ${fwd(dir)}: not the server\n`;
const replay = (dir, text) => `${banner(dir)}${text}${banner(dir)}`;

// The places the scripts write by default, as they are now.
const DEFAULTS = ['E:/FMIP/data-audit/runs', 'E:/FMIP/ops/reports/ops-release/snapshots', 'E:/FMIP/ops/sitemap-count.log'];
const look = () =>
  DEFAULTS.map((p) => {
    if (!existsSync(p)) return `${p}: absent`;
    const s = statSync(p);
    return s.isDirectory() ? `${p}: ${readdirSync(p).sort().join(',')}` : `${p}: ${s.size} ${s.mtimeMs}`;
  });
const before = look();

const SAMPLE = {
  run: 'R1 extra_time_sum | critical | 0 | \nS2 scheduled_in_the_past | major | 2 | Dundee United v Hearts\n',
  'ops-check': '== containers\napi Up 3 days (healthy)\n== end\n',
  'server-hardening': '== site headers (https://traveltohormuz.ir/en)\npresent: strict-transport-security\n== end\n',
  'seo-check': '== robots.txt\nUser-agent: *\n== sitemap\nurls: 4321\n== end\n',
  'structured-data': '=== /en | 200 0.41\n  HTML <html lang="en" dir="ltr">\n  LD WebSite\n=== end\n',
};

// ---------- 1. each script prints its fixture between two loud lines and opens no connection ----------
for (const name of Object.keys(SCRIPTS)) {
  const dir = fixtureDir({ [`${name}.txt`]: SAMPLE[name] });
  const r = run(name, { fixture: dir });
  check(`${name}: prints its fixture between a first and a last "FIXTURE REPLAY" line`, r.out === replay(dir, SAMPLE[name]), JSON.stringify(r.out));
  check(`${name}: exits 0 when there is no .exit file`, r.code === 0, `${r.code} ${r.err}`);
  check(`${name}: opens no connection with FMIP_FIXTURE set`, r.net === '', r.net);
}

// ---------- 2. a fixture's exit code is returned ----------
for (const name of Object.keys(SCRIPTS)) {
  const dir = fixtureDir({ [`${name}.txt`]: SAMPLE[name], [`${name}.exit`]: '3\r\n' });
  const r = run(name, { fixture: dir });
  check(`${name}: returns the fixture's exit code`, r.code === 3, `${r.code} ${r.err}`);
  check(`${name}: still prints the fixture on a failing code`, r.out === replay(dir, SAMPLE[name]), JSON.stringify(r.out));
  check(`${name}: opens no connection on a failing code`, r.net === '', r.net);
}

// ---------- 3. a leftover FMIP_FIXTURE, a missing or a broken fixture: an error, never the server ----------
for (const name of Object.keys(SCRIPTS)) {
  const left = fixtureDir({ [`${name}.txt`]: SAMPLE[name] });
  const l = run(name, { fixture: left, ok: false });
  const lines = l.out.trim().split('\n');
  check(`${name}: FMIP_FIXTURE without FMIP_FIXTURE_OK=1 exits 2`, l.code === 2, `${l.code}`);
  check(`${name}: ... says so in its first and last line and replays nothing`, lines[0] === banner(left).trim() && lines.at(-1) === banner(left).trim() && /without FMIP_FIXTURE_OK=1/.test(l.out) && !l.out.includes(SAMPLE[name].split('\n')[0]), l.out);
  check(`${name}: ... and opens no connection`, l.net === '', l.net);
  const missing = run(name, { fixture: fixtureDir({}) });
  check(`${name}: a missing fixture exits 2, named, with no connection`, missing.code === 2 && /missing/.test(missing.out) && missing.net === '', `${missing.code} ${missing.out}${missing.err}${missing.net}`);
  const broken = run(name, { fixture: fixtureDir({ [`${name}.txt`]: 'x\n', [`${name}.exit`]: 'zero' }) });
  check(`${name}: an exit file that holds no number exits 2`, broken.code === 2 && broken.net === '', `${broken.code} ${broken.net}`);
}
{
  const dir = fixtureDir({ 'ops-check.txt': '== no newline at the end' });
  const r = run('ops-check', { fixture: dir });
  check('a fixture without a last newline still ends with the loud line on its own', r.out === replay(dir, '== no newline at the end\n'), JSON.stringify(r.out));
}

// ---------- 4. the control: without FMIP_FIXTURE the stand-ins are reached ----------
for (const name of Object.keys(SCRIPTS)) {
  const r = run(name, { opsRoot: join(root, `control-${name}`) });
  check(`${name}: without FMIP_FIXTURE it goes to the server (the stand-in ssh is called)`, /^ssh /m.test(r.net), r.net);
  check(`${name}: and fails when the server cannot be reached`, r.code !== 0, `${r.code}`);
  check(`${name}: a real run prints no FIXTURE REPLAY line`, !r.out.includes('FIXTURE REPLAY'), r.out);
}

// ---------- 5. OPS_ROOT moves every output folder; run.sh has a fixture per query file ----------
{
  const ops = join(root, 'ops-run');
  const r = run('run', { fixture: fixtureDir({ 'run.txt': SAMPLE.run }), opsRoot: ops });
  const runs = filesIn(join(ops, 'data-audit', 'runs'));
  check('run.sh: a replayed invariants run is saved under $OPS_ROOT/data-audit/runs', r.code === 0 && runs.length === 1 && /^\d{4}-\d{2}-\d{2}T\d{4}Z\.txt$/.test(runs[0] ?? ''), runs.join());
  check('run.sh: the saved run is the fixture, without the loud lines', runs.length === 1 && readFileSync(join(ops, 'data-audit', 'runs', runs[0]), 'utf8') === SAMPLE.run);

  const failed = join(root, 'ops-run-failed');
  run('run', { fixture: fixtureDir({ 'run.txt': 'AUDIT-ERROR: exit 3\n', 'run.exit': '3' }), opsRoot: failed });
  check('run.sh: a failed replay is not saved (as a failed run is not)', filesIn(join(failed, 'data-audit', 'runs')).length === 0);

  const drill = join(root, 'growth-funnel.sql');
  writeFileSync(drill, 'SELECT 1;\n');
  const drillOps = join(root, 'ops-drill');
  const drillFx = fixtureDir({ 'run.txt': SAMPLE.run, 'run-growth-funnel.txt': 'signed up | 12\n' });
  const d = run('run', { fixture: drillFx, opsRoot: drillOps, args: [fwd(drill)] });
  check('run.sh: another query file replays run-<its name>.txt, not the invariants', d.code === 0 && d.out === replay(drillFx, 'signed up | 12\n') && d.net === '', `${d.code} ${d.out}`);
  check('run.sh: a drill is not saved as a run', filesIn(join(drillOps, 'data-audit', 'runs')).length === 0);
  const noDrill = run('run', { fixture: fixtureDir({ 'run.txt': SAMPLE.run }), args: [fwd(drill)] });
  check('run.sh: a query file with no fixture of its own is an error, not the invariants', noDrill.code === 2 && /run-growth-funnel\.txt is missing/.test(noDrill.out) && !noDrill.out.includes('R1 extra_time_sum'), noDrill.out);

  const audit = join(root, 'audit-out');
  run('run', { fixture: fixtureDir({ 'run.txt': SAMPLE.run }), opsRoot: join(root, 'ops-unused'), more: { AUDIT_OUT: fwd(audit) } });
  check('run.sh: AUDIT_OUT still wins over OPS_ROOT', filesIn(audit).length === 1 && !existsSync(join(root, 'ops-unused', 'data-audit')));

  const snap = join(root, 'ops-snap');
  const o = run('ops-check', { fixture: fixtureDir({ 'ops-check.txt': SAMPLE['ops-check'], 'ops-check.exit': '255' }), opsRoot: snap });
  const snaps = filesIn(join(snap, 'reports', 'ops-release', 'snapshots'));
  check('ops-check.sh: the replay is saved under $OPS_ROOT/reports/ops-release/snapshots, a failing one too', o.code === 255 && snaps.length === 1, snaps.join());
  check('ops-check.sh: the saved snapshot is the fixture', snaps.length === 1 && readFileSync(join(snap, 'reports', 'ops-release', 'snapshots', snaps[0]), 'utf8') === SAMPLE['ops-check']);

  const opsOut = join(root, 'ops-out');
  run('ops-check', { fixture: fixtureDir({ 'ops-check.txt': SAMPLE['ops-check'] }), opsRoot: join(root, 'ops-unused-2'), more: { OPS_OUT: fwd(opsOut) } });
  check('ops-check.sh: OPS_OUT still wins over OPS_ROOT', filesIn(opsOut).length === 1 && !existsSync(join(root, 'ops-unused-2', 'reports')));

  const seo = join(root, 'ops-seo');
  run('seo-check', { fixture: fixtureDir({ 'seo-check.txt': SAMPLE['seo-check'] }), opsRoot: seo });
  const logged = existsSync(join(seo, 'sitemap-count.log')) ? readFileSync(join(seo, 'sitemap-count.log'), 'utf8') : '';
  check('seo-check.sh: the sitemap count goes to $OPS_ROOT/sitemap-count.log', /^\d{4}-\d{2}-\d{2} 4321\n$/.test(logged), JSON.stringify(logged));

  for (const name of ['server-hardening', 'structured-data']) {
    const quiet = join(root, `ops-${name}`);
    run(name, { fixture: fixtureDir({ [`${name}.txt`]: SAMPLE[name] }), opsRoot: quiet });
    check(`${name}: writes nothing`, !existsSync(quiet) || readdirSync(quiet).length === 0);
  }
}

// ---------- 6. a replay with no OPS_ROOT keeps nothing (never among the real runs) ----------
for (const name of ['run', 'ops-check', 'seo-check']) {
  const dir = fixtureDir({ [`${name}.txt`]: SAMPLE[name] });
  const r = run(name, { fixture: dir, opsRoot: null });
  check(`${name}: a replay with no OPS_ROOT still prints its fixture and opens no connection`, r.code === 0 && r.out === replay(dir, SAMPLE[name]) && r.net === '', `${r.code} ${r.net}`);
}

// ---------- 7. nothing was written where the scripts write by default ----------
{
  const after = look();
  check('nothing written under E:/FMIP/data-audit/ or E:/FMIP/ops/', after.join('\n') === before.join('\n'), `${before.join('\n')}\n--- after ---\n${after.join('\n')}`);
}

rmSync(root, { recursive: true, force: true });
console.log(`${right} of ${right + wrong} right (shell ${bash})`);
process.exit(wrong === 0 ? 0 : 1);
