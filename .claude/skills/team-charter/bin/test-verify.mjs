// Runs verify.mjs on its cases (T-1896): `node .claude/skills/team-charter/bin/test-verify.mjs`.
// Run it after any change to verify.mjs, finding.mjs or data-audit/run.sh's fixture mode; it exits 1
// on a wrong result. It works the same from Git Bash, PowerShell or cmd.
//
// Every case works in a temp folder through OPS_ROOT, so the real findings are never touched, and with
// a PATH whose first folder holds `ssh`, `scp` and `curl` stand-ins that log each call, then Git's own
// usr/bin. MSYSTEM is set, so verify.mjs takes `bash` from that PATH (Git's usr/bin/bash.exe, which
// keeps PATH as given, never the bin/bash.exe launcher). Before any case runs, that shell must resolve
// all three to the stand-ins, or the test stops with exit 1 having run nothing: the cases of the real
// path talk to the stand-in, never to the server. In fixture mode the log must stay empty.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'verify.mjs');
const finding = join(here, 'finding.mjs');
const TODAY = '2026-11-27';
const fwd = (p) => p.replace(/\\/g, '/');

let right = 0;
let wrong = 0;
function check(name, ok, detail = '') {
  if (ok) right += 1;
  else {
    wrong += 1;
    console.log(`WRONG  ${name}${detail ? `\n       ${String(detail).replace(/\n/g, '\n       ')}` : ''}`);
  }
}

const temp = mkdtempSync(join(tmpdir(), 'verify-test-'));
const shims = join(temp, 'shims');
mkdirSync(shims);
// ssh prints $SHIM_RESPONSE when it is given and exits $SHIM_EXIT (255, "cannot connect", by default)
writeFileSync(
  join(shims, 'ssh'),
  '#!/bin/sh\nprintf "ssh" >> "$SHIM_LOG"; for a in "$@"; do printf " [%s]" "$a" >> "$SHIM_LOG"; done; echo >> "$SHIM_LOG"\n[ -n "$SHIM_RESPONSE" ] && cat "$SHIM_RESPONSE"\nexit ${SHIM_EXIT:-255}\n',
  { mode: 0o755 },
);
for (const name of ['scp', 'curl']) writeFileSync(join(shims, name), `#!/bin/sh\necho "${name} $*" >> "$SHIM_LOG"\nexit 255\n`, { mode: 0o755 });

const win = process.platform === 'win32';
const gitRoot = fwd(process.env.EXEPATH ? dirname(process.env.EXEPATH) : 'C:/Program Files/Git');
if (win && !existsSync(`${gitRoot}/usr/bin/bash.exe`)) {
  console.log(`STOPPED  ${gitRoot}/usr/bin/bash.exe is not there: no shell that keeps the stand-ins first, so nothing was run`);
  process.exit(1);
}
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
const PATH = [shims, ...(win ? [`${gitRoot}/usr/bin`, `${gitRoot}/mingw64/bin`] : []), process.env[pathKey]].join(win ? ';' : ':');
function baseEnv(more = {}) {
  const env = { ...process.env, [pathKey]: PATH, MSYSTEM: 'MINGW64', FINDING_TODAY: TODAY, ...more };
  for (const key of ['BASH_ENV', 'ENV', 'FMIP_FIXTURE', 'FMIP_FIXTURE_OK', 'AUDIT_OUT', 'OPS_ROOT']) if (!(key in more)) delete env[key];
  return env;
}

// The stand-ins must be what verify.mjs's shell finds, or nothing runs.
{
  const probe = spawnSync(
    'bash',
    ['-c', 'd="$(cd "$1" && pwd)"; for p in ssh scp curl; do w="$(command -v "$p")"; [ "$w" = "$d/$p" ] || { echo "$p resolves to ${w:-nothing}, not $d/$p (shell $BASH)"; exit 1; }; done', 'probe', fwd(shims)],
    { encoding: 'utf8', env: baseEnv(), timeout: 30_000 },
  );
  if (probe.status !== 0) {
    console.log(`STOPPED  the stand-ins are not first for the shell verify.mjs takes: ${(probe.stdout + probe.stderr).trim() || probe.error?.message}; nothing was run`);
    process.exit(1);
  }
}

let count = 0;
/** A fresh ops folder seeded with findings, and a fixture folder with `files`. */
function setup(findings, files = {}) {
  const root = join(temp, `case-${(count += 1)}`);
  mkdirSync(join(root, 'findings'), { recursive: true });
  writeFileSync(join(root, 'findings', '2026-11-20.jsonl'), `${findings.map((f) => JSON.stringify(f)).join('\n')}\n`);
  const fx = join(root, 'fixture');
  mkdirSync(fx);
  for (const [name, text] of Object.entries(files)) writeFileSync(join(fx, name), text);
  return { root, fx, log: join(root, 'network.log') };
}

function verify(c, { args = [], fixture = true, more = {} } = {}) {
  const env = baseEnv({ OPS_ROOT: fwd(c.root), SHIM_LOG: fwd(c.log), ...more });
  if (fixture) {
    env.FMIP_FIXTURE = fwd(c.fx);
    if (!('FMIP_FIXTURE_OK' in more)) env.FMIP_FIXTURE_OK = '1';
  }
  writeFileSync(c.log, '');
  const r = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8', env, timeout: 120_000 });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '', net: readFileSync(c.log, 'utf8') };
}

/** The lines verify.mjs appended: today's file only (the seed is dated 2026-11-20). */
const appended = (c) => {
  const file = join(c.root, 'findings', `${TODAY}.jsonl`);
  return existsSync(file) ? readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const lineOf = (c, id) => appended(c).find((l) => l.id === id);
const outLine = (r, id) => r.out.split('\n').find((l) => l.includes(id)) ?? '';

let seq = 0;
/** A fixed-unverified finding; a `verify` is the finding's own agent's unless `verify_by` says otherwise. */
const fu = (agent, prefix, over = {}) => ({
  id: `${prefix}-2026-11-20-${String((seq += 1)).padStart(2, '0')}`,
  agent,
  severity: 'minor',
  visible_to_users: false,
  title: `fixed thing ${seq}`,
  evidence: 'shipped in #900',
  likely_cause: 'unknown',
  proposal: 'none',
  owner: 'engineering-session',
  confidence: 'high',
  status: 'fixed-unverified',
  first_seen: '2026-11-20',
  ...('verify' in over && !('verify_by' in over) ? { verify_by: agent } : {}),
  ...over,
});

const http = (status, headers, body) => `HTTP/2 ${status}\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n${body}`;
const PAD = `<div>${'football '.repeat(600)}</div>`; // a real page is far over 4 KB
const RUN = 'R1 extra_time_sum | critical | 3 | Copa del Rey 2025/26 2025-10-04\nS2 scheduled_in_the_past | major | 0 | \nI4 club_without_country | info | 4013 | \n';
const NEWS = http(200, { 'content-type': 'text/html' }, `<html><h2>Arsenal&#x27;s late winner</h2><p>Football news</p>${PAD}</html>`);
const STORY = http(200, { 'content-type': 'text/html' }, `<html><h1>Arsenal win</h1>${PAD}</html>`);
const HOME = http(200, { 'X-Frame-Options': 'DENY', 'X-Powered-By': 'Next.js-secret-build' }, `<html>home${PAD}</html>`);

// ---------- 1. fixtures: verdicts, the one door, no connection ----------
{
  const F = {
    s2: fu('data-auditor', 'aud', { verify: 'S2 scheduled_in_the_past' }),
    r1: fu('data-auditor', 'aud', { verify: 'R1' }),
    byName: fu('data-auditor', 'aud', { verify: 'scheduled_in_the_past', verify_by: 'engineering-session' }),
    absent: fu('data-auditor', 'aud', { verify: 'Z9 no_such_check' }),
    lacks: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en/news/arsenal-win lacks "fragrance"' }),
    has: fu('qa-engineer', 'qa', { verify: "/en/news has \"Arsenal's late winner\"" }),
    listLacks: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en/news lacks "fragrance"' }),
    homeLacks: fu('qa-engineer', 'qa', { verify: '/en lacks "fragrance"' }),
    tiny: fu('qa-engineer', 'qa', { verify: '/en/news/empty-story lacks "fragrance"' }),
    gone: fu('qa-engineer', 'qa', { verify: 'GET https://traveltohormuz.ir/en/old status 200' }),
    challenge: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en/blocked status 200' }),
    frame: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en header x-frame-options: deny' }),
    powered: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en no-header x-powered-by' }),
    hsts: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en header strict-transport-security' }),
    down: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en/down has "error"' }),
    other: fu('qa-engineer', 'qa', { verify: 'https://example.com/ status 200' }),
    lookalike: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir.example.com/ status 200' }),
    plain: fu('qa-engineer', 'qa', { verify: 'http://traveltohormuz.ir/en status 200' }),
    port: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir:8443/en status 200' }),
    user: fu('qa-engineer', 'qa', { verify: 'https://x@traveltohormuz.ir/en status 200' }),
    post: fu('qa-engineer', 'qa', { verify: 'POST https://traveltohormuz.ir/api/x status 200' }),
    quote: fu('qa-engineer', 'qa', { verify: "https://traveltohormuz.ir/en/a'$(id) status 200" }),
    two: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en status 200 has home' }),
    nonsense: fu('qa-engineer', 'qa', { verify: 'check the page by eye' }),
    byOther: fu('qa-engineer', 'qa', { verify: '/en status 200', verify_by: 'data-auditor' }),
    unrecorded: fu('qa-engineer', 'qa', { verify: '/en status 200', verify_by: undefined }),
    person: fu('ops-release', 'ops', { owner: 'ops-release', title: 'off-provider backup works again' }),
    secret: fu('security', 'sec', { title: 'the title that stays on this computer', severity: 'major' }),
    secretCheck: fu('security', 'sec', { title: 'weak header title', verify: 'https://traveltohormuz.ir/en/secret-weak-spot status 404' }),
    stillOpen: fu('qa-engineer', 'qa', { status: 'open', verify: 'S2' }),
  };
  delete F.unrecorded.verify_by;
  const c = setup(Object.values(F), {
    'run.txt': RUN,
    'get_en_news.txt': NEWS,
    'get_en_news_arsenal_win.txt': STORY,
    'get_en_news_empty_story.txt': http(200, {}, '<html></html>'),
    'get_en.txt': HOME,
    'get_en_old.txt': http(404, {}, 'not found'),
    'get_en_blocked.txt': http(403, { server: 'cloudflare' }, 'challenge'),
    'get_en_down.txt': http(502, {}, 'bad gateway'),
    'get_en_secret_weak_spot.txt': http(404, {}, PAD),
  });
  const r = verify(c);
  const status = (f) => lineOf(c, f.id)?.status;
  check('fixtures: no connection is opened', r.net === '', r.net);
  check('fixtures: the output says it is a replay', /FIXTURE REPLAY from .*: not the server/.test(r.out.split('\n')[0]), r.out.split('\n')[0]);
  check('a passing invariant moves its finding to resolved', status(F.s2) === 'resolved', r.out);
  check('a failing invariant moves its finding to open, with what it saw', status(F.r1) === 'open' && /R1 extra_time_sum: 3 violation\(s\) \(Copa del Rey/.test(lineOf(c, F.r1.id)?.evidence ?? ''), lineOf(c, F.r1.id)?.evidence);
  check('a check set by the engineering session is judged', status(F.byName) === 'resolved', r.out);
  check('every verdict line says whose check it was', /check by engineering-session  data-audit/.test(outLine(r, F.byName.id)) && /check by qa-engineer  GET/.test(outLine(r, F.has.id)), `${outLine(r, F.byName.id)}\n${outLine(r, F.has.id)}`);
  check('the resolved line names the check and its 0', /check: S2 scheduled_in_the_past\. Seen: data-audit\/run\.sh, S2 scheduled_in_the_past: 0 violation\(s\); the fix holds\.$/.test(lineOf(c, F.s2.id)?.evidence ?? ''), lineOf(c, F.s2.id)?.evidence);
  check('the verdict lines are written as the engineering session', appended(c).every((l) => l.written_by === 'engineering-session'), JSON.stringify(appended(c).map((l) => l.written_by)));
  check('an invariant the run does not print changes nothing', status(F.absent) === undefined && /no invariant "Z9 no_such_check"/.test(r.out), r.out);
  check("lacks: an item's own page without the text resolves", status(F.lacks) === 'resolved', outLine(r, F.lacks.id));
  check('has: a page with the text resolves, entities decoded', status(F.has) === 'resolved', outLine(r, F.has.id));
  check('lacks on a list page (/en/news) is refused, nothing written', status(F.listLacks) === undefined && /a page that lists items/.test(outLine(r, F.listLacks.id)), outLine(r, F.listLacks.id));
  check('lacks on the home page is refused too', status(F.homeLacks) === undefined && /a page that lists items/.test(outLine(r, F.homeLacks.id)), outLine(r, F.homeLacks.id));
  check('lacks on a near-empty 200 page is not judged', status(F.tiny) === undefined && /too little/.test(outLine(r, F.tiny.id)), outLine(r, F.tiny.id));
  check('status: another code opens', status(F.gone) === 'open' && /HTTP 404, not 200/.test(lineOf(c, F.gone.id)?.evidence ?? ''));
  check('status: a 403 (a challenge, perhaps) is not judged', status(F.challenge) === undefined && /HTTP 403/.test(outLine(r, F.challenge.id)), outLine(r, F.challenge.id));
  check('header with a value: present and holding it resolves (case ignored)', status(F.frame) === 'resolved', outLine(r, F.frame.id));
  check('no-header: a header that is there opens', status(F.powered) === 'open');
  check("a header's value is never written", !JSON.stringify(appended(c)).includes('Next.js-secret-build') && !r.out.includes('Next.js-secret-build'), lineOf(c, F.powered.id)?.evidence);
  check('header: a header that is missing opens', status(F.hsts) === 'open');
  check('a text assertion on a 5xx answer changes nothing', status(F.down) === undefined && /HTTP 502/.test(outLine(r, F.down.id)), outLine(r, F.down.id));
  for (const k of ['other', 'lookalike', 'plain', 'port', 'user']) {
    check(`an address off our own site is not judged (${F[k].verify})`, status(F[k]) === undefined && /not our own site|user name/.test(outLine(r, F[k].id)), outLine(r, F[k].id));
  }
  check('a method other than GET is refused', status(F.post) === undefined && /GET and nothing else/.test(outLine(r, F.post.id)));
  check('an address holding a quote or $( is refused', status(F.quote) === undefined && /does not send/.test(outLine(r, F.quote.id)), outLine(r, F.quote.id));
  check('two assertions are not one', status(F.two) === undefined && /one assertion after the address/.test(outLine(r, F.two.id)));
  check('a verify that is neither is not understood', status(F.nonsense) === undefined && /not understood/.test(outLine(r, F.nonsense.id)));
  check("a check set by another agent is listed, not judged", status(F.byOther) === undefined && /set by data-auditor, not by qa-engineer or the engineering session/.test(outLine(r, F.byOther.id)), outLine(r, F.byOther.id));
  check('a check whose setter was not recorded is listed, not judged', status(F.unrecorded) === undefined && /set by an unrecorded writer/.test(outLine(r, F.unrecorded.id)), outLine(r, F.unrecorded.id));
  check('a finding without verify is listed as needing a person or its agent, with its owner', /  ops-2026-11-20-\d+  owner ops-release  minor  "off-provider backup works again"/.test(r.out), r.out);
  check('a security finding with a check is never judged, nothing written', status(F.secretCheck) === undefined && status(F.secret) === undefined, JSON.stringify(appended(c)));
  check('security findings are listed for the security agent by id alone', /needs the security agent[^\n]*\(2\)\n  sec-2026-11-20-\d+\n  sec-2026-11-20-\d+\n/.test(r.out), r.out);
  check("a security finding's title, address and assertion are not printed", !r.out.includes(F.secret.title) && !r.out.includes('weak header title') && !r.out.includes('secret-weak-spot'), r.out);
  check('a finding that is not fixed-unverified is left alone', status(F.stillOpen) === undefined && !r.out.includes(F.stillOpen.id));
  check('every appended line carries the id, its verify and the agent of the first line', appended(c).every((l) => Object.values(F).some((f) => f.id === l.id && f.verify === l.verify && f.agent === l.agent)), JSON.stringify(appended(c)));
  check('exactly the judged findings got a line', appended(c).length === 9, appended(c).map((l) => `${l.id} ${l.status}`).join(', '));
  const lint = spawnSync(process.execPath, [finding, 'validate', TODAY], { encoding: 'utf8', env: { ...process.env, OPS_ROOT: c.root } });
  check('the appended lines pass finding.mjs validate (they came through its door)', lint.status === 0, lint.stdout + lint.stderr);
  check('a finding came back open: exit 3', r.code === 3, `${r.code} ${r.err}`);
  check('the summary line counts', /^VERIFY: 5 resolved, 4 open, 15 not judged, 2 need the security agent, 3 need a person or its agent$/m.test(r.out), r.out.split('\n').at(-2));
  const runs = existsSync(join(c.root, 'data-audit', 'runs')) ? readdirSync(join(c.root, 'data-audit', 'runs')) : [];
  check('run.sh ran once, in fixture mode, and saved under OPS_ROOT', runs.length === 1, runs.join());

  const again = verify(c);
  check('a second run finds nothing left of what it judged', !again.out.includes(F.s2.id) && !again.out.includes(F.r1.id) && appended(c).length === 9, again.out);
}

// ---------- 2. an unreachable server changes nothing and says so ----------
{
  const a = fu('data-auditor', 'aud', { verify: 'S2 scheduled_in_the_past' });
  const b = fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en/news/a-story lacks "fragrance"' });
  const c = setup([a, b], { 'run.txt': '', 'run.exit': '2', 'get_en_news_a_story.txt': '', 'get_en_news_a_story.exit': '28' });
  const r = verify(c);
  check('unreachable: nothing is appended', appended(c).length === 0, JSON.stringify(appended(c)));
  check('unreachable: it says the server could not be read', /aud-\S+  the server could not be read: run\.sh exit 2/.test(r.out), r.out);
  check('unreachable: it says the page could not be read', /qa-\S+  curl on the server exit 28/.test(r.out), r.out);
  check('unreachable: exit 4', r.code === 4, `${r.code} ${r.err}`);
  check('unreachable: no connection in fixture mode', r.net === '');
  const missing = setup([b]);
  const m = verify(missing);
  check('a page with no fixture is not judged and opens no connection', appended(missing).length === 0 && /get_en_news_a_story\.txt is missing/.test(m.out) && m.net === '', m.out + m.net);
}

// ---------- 3. a dry run writes nothing; a leftover FMIP_FIXTURE is refused ----------
{
  const a = fu('data-auditor', 'aud', { verify: 'S2' });
  const b = fu('data-auditor', 'aud', { verify: 'R1 extra_time_sum' });
  const c = setup([a, b], { 'run.txt': RUN });
  const r = verify(c, { args: ['--dry-run'] });
  check('dry run: nothing appended', appended(c).length === 0);
  check('dry run: the verdicts are printed, each with whose check it was', /would be resolved \(1\)\n  aud-\S+  check by data-auditor  data-audit/.test(r.out) && /would be open again \(1\)\n  aud-\S+  check by data-auditor  /.test(r.out), r.out);  check('dry run: exit 3 still says one would be open', r.code === 3);
  const bad = verify(c, { args: ['--now'] });
  check('an unknown argument is refused with exit 1', bad.code === 1 && /unknown argument/.test(bad.err), bad.err);
  const loose = verify(c, { more: { OPS_ROOT: '' } });
  check('FMIP_FIXTURE without OPS_ROOT is refused: fixture verdicts never reach the real findings', loose.code === 1 && /without OPS_ROOT/.test(loose.err) && loose.net === '', loose.err);
  const left = verify(c, { args: ['--dry-run'], more: { FMIP_FIXTURE_OK: '' } });
  check('FMIP_FIXTURE without FMIP_FIXTURE_OK=1 is refused, nothing judged', left.code === 1 && /without FMIP_FIXTURE_OK=1/.test(left.err) && left.out === '' && left.net === '', left.err);
}

// ---------- 4. the real path: a GET through ssh, nothing else ----------
{
  const a = fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en/news/arsenal-win lacks "fragrance"' });
  const b = fu('qa-engineer', 'qa', { verify: '/en/news/arsenal-win has "arsenal win"' });
  const c = setup([a, b]);
  const response = join(c.root, 'answer.txt');
  writeFileSync(response, STORY);
  const r = verify(c, { fixture: false, more: { SHIM_RESPONSE: fwd(response), SHIM_EXIT: '0' } });
  const calls = r.net.trim().split('\n').filter(Boolean);
  check('real path: both findings resolved', lineOf(c, a.id)?.status === 'resolved' && lineOf(c, b.id)?.status === 'resolved', r.out + r.err);
  check('real path: one page is read once', calls.length === 1, r.net);
  check(
    'real path: ssh to fmip-prod with one GET by curl -q on our own site, nothing else',
    calls[0] === "ssh [-o] [ConnectTimeout=20] [-o] [BatchMode=yes] [fmip-prod] [curl -q -s -i -m 25 --proto =https --max-redirs 0 'https://traveltohormuz.ir/en/news/arsenal-win']",
    r.net,
  );
  check('real path: no method, no data, no upload is sent', !/\s(-X|--request|-d|--data[\w-]*|-F|--form|-T|--upload-file|-u|-H)\s/.test(calls[0] ?? ''), calls[0]);

  const down = setup([fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en status 200' })]);
  const d = verify(down, { fixture: false });
  check('real path, server unreachable (ssh 255): nothing appended, it says so, exit 4', appended(down).length === 0 && /could not be reached \(ssh exit 255/.test(d.out) && d.code === 4, d.out + d.err);
}

rmSync(temp, { recursive: true, force: true });
console.log(`${right} of ${right + wrong} right`);
process.exit(wrong === 0 ? 0 : 1);
