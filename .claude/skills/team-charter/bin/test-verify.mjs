// Runs verify.mjs on its cases (T-1896): `node .claude/skills/team-charter/bin/test-verify.mjs`.
// Run it after any change to verify.mjs, finding.mjs or data-audit/run.sh's fixture mode; it exits 1
// on a wrong result. Every case works in a temp folder through OPS_ROOT, so the real findings are
// never touched, and with a PATH whose `ssh`, `scp` and `curl` are stand-ins that log each call:
// in fixture mode the log must stay empty, and the cases of the real path read what was sent.
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
const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === 'PATH') ?? 'PATH';
const sep = process.platform === 'win32' ? ';' : ':';

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
  const env = { ...process.env, [pathKey]: `${shims}${sep}${process.env[pathKey]}`, OPS_ROOT: fwd(c.root), FINDING_TODAY: TODAY, SHIM_LOG: fwd(c.log), ...more };
  delete env.FMIP_FIXTURE;
  delete env.AUDIT_OUT;
  if (fixture) env.FMIP_FIXTURE = fwd(c.fx);
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

let seq = 0;
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
  ...over,
});

const http = (status, headers, body) => `HTTP/2 ${status}\r\n${Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n${body}`;
const RUN = 'R1 extra_time_sum | critical | 3 | Copa del Rey 2025/26 2025-10-04\nS2 scheduled_in_the_past | major | 0 | \nI4 club_without_country | info | 4013 | \n';
const NEWS = http(200, { 'content-type': 'text/html' }, '<html><h2>Arsenal&#x27;s late winner</h2><p>Football news</p></html>');
const HOME = http(200, { 'X-Frame-Options': 'DENY', 'X-Powered-By': 'Next.js' }, '<html>home</html>');

// ---------- 1. fixtures: verdicts, the one door, no connection ----------
{
  const F = {
    s2: fu('data-auditor', 'aud', { verify: 'S2 scheduled_in_the_past' }),
    r1: fu('data-auditor', 'aud', { verify: 'R1' }),
    byName: fu('data-auditor', 'aud', { verify: 'scheduled_in_the_past' }),
    absent: fu('data-auditor', 'aud', { verify: 'Z9 no_such_check' }),
    lacks: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en/news lacks "fragrance"' }),
    has: fu('qa-engineer', 'qa', { verify: "/en/news has \"Arsenal's late winner\"" }),
    gone: fu('qa-engineer', 'qa', { verify: 'GET https://traveltohormuz.ir/en/old status 200' }),
    frame: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en header x-frame-options: deny' }),
    powered: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en no-header x-powered-by' }),
    hsts: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en header strict-transport-security' }),
    down: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en/down lacks "error"' }),
    other: fu('qa-engineer', 'qa', { verify: 'https://example.com/ status 200' }),
    lookalike: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir.example.com/ status 200' }),
    plain: fu('qa-engineer', 'qa', { verify: 'http://traveltohormuz.ir/en status 200' }),
    port: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir:8443/en status 200' }),
    user: fu('qa-engineer', 'qa', { verify: 'https://x@traveltohormuz.ir/en status 200' }),
    post: fu('qa-engineer', 'qa', { verify: 'POST https://traveltohormuz.ir/api/x status 200' }),
    quote: fu('qa-engineer', 'qa', { verify: "https://traveltohormuz.ir/en/a'$(id) status 200" }),
    two: fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en status 200 has home' }),
    nonsense: fu('qa-engineer', 'qa', { verify: 'check the page by eye' }),
    person: fu('ops-release', 'ops', { owner: 'ops-release', title: 'off-provider backup works again' }),
    secret: fu('security', 'sec', { title: 'the title that stays on this computer', severity: 'major' }),
    stillOpen: fu('qa-engineer', 'qa', { status: 'open', verify: 'S2' }),
  };
  const c = setup(Object.values(F), {
    'run.txt': RUN,
    'get_en_news.txt': NEWS,
    'get_en.txt': HOME,
    'get_en_old.txt': http(404, {}, 'not found'),
    'get_en_down.txt': http(502, {}, 'bad gateway'),
  });
  const r = verify(c);
  const status = (f) => lineOf(c, f.id)?.status;
  check('fixtures: no connection is opened', r.net === '', r.net);
  check('a passing invariant moves its finding to resolved', status(F.s2) === 'resolved', r.out);
  check('an invariant named by its code alone is judged', status(F.r1) === 'open', r.out);
  check('an invariant named by its name alone is judged', status(F.byName) === 'resolved', r.out);
  check('a failing invariant moves its finding to open, with what it saw', status(F.r1) === 'open' && /R1 extra_time_sum: 3 violation\(s\) \(Copa del Rey/.test(lineOf(c, F.r1.id)?.evidence ?? ''), lineOf(c, F.r1.id)?.evidence);
  check('the resolved line names the check and its 0', /verify "S2 scheduled_in_the_past": data-audit\/run\.sh, S2 scheduled_in_the_past: 0 violation\(s\); the fix holds/.test(lineOf(c, F.s2.id)?.evidence ?? ''), lineOf(c, F.s2.id)?.evidence);
  check('an invariant the run does not print changes nothing', status(F.absent) === undefined && /no invariant "Z9 no_such_check"/.test(r.out), r.out);
  check('lacks: a page without the text resolves', status(F.lacks) === 'resolved');
  check('has: a page with the text resolves, entities decoded', status(F.has) === 'resolved', r.out);
  check('status: another code opens', status(F.gone) === 'open' && /HTTP 404, not 200/.test(lineOf(c, F.gone.id)?.evidence ?? ''));
  check('header with a value: present and holding it resolves (case ignored)', status(F.frame) === 'resolved', r.out);
  check('no-header: a header that is there opens', status(F.powered) === 'open');
  check('header: a header that is missing opens', status(F.hsts) === 'open');
  check('a text assertion on a 5xx answer changes nothing', status(F.down) === undefined && /HTTP 502/.test(r.out), r.out);
  for (const k of ['other', 'lookalike', 'plain', 'port', 'user']) {
    check(`an address off our own site is not judged (${F[k].verify})`, status(F[k]) === undefined && /not our own site|user name/.test(r.out.split('\n').find((l) => l.includes(F[k].id)) ?? ''), r.out);
  }
  check('a method other than GET is refused', status(F.post) === undefined && /GET and nothing else/.test(r.out));
  check('an address holding a quote or $( is refused', status(F.quote) === undefined && /does not send/.test(r.out.split('\n').find((l) => l.includes(F.quote.id)) ?? ''), r.out);
  check('two assertions are not one', status(F.two) === undefined && /one assertion after the address/.test(r.out));
  check('a verify that is neither is not understood', status(F.nonsense) === undefined && /not understood/.test(r.out.split('\n').find((l) => l.includes(F.nonsense.id)) ?? ''));
  check('a finding without verify is listed as needing a person or its agent, with its owner', /needs a person or its agent[^\n]*\n(?:  .*\n)*  ops-2026-11-20-\d+  owner ops-release  minor  "off-provider backup works again"/.test(r.out), r.out);
  check("a security finding's title is not printed", r.out.includes(F.secret.id) && !r.out.includes(F.secret.title), r.out);
  check('a finding that is not fixed-unverified is left alone', status(F.stillOpen) === undefined && !r.out.includes(F.stillOpen.id));
  check('every appended line carries the id, its verify and the agent of the first line', appended(c).every((l) => Object.values(F).some((f) => f.id === l.id && f.verify === l.verify && f.agent === l.agent)), JSON.stringify(appended(c)));
  check('exactly the judged findings got a line', appended(c).length === 9, appended(c).map((l) => `${l.id} ${l.status}`).join(', '));
  const lint = spawnSync(process.execPath, [finding, 'validate', TODAY], { encoding: 'utf8', env: { ...process.env, OPS_ROOT: c.root } });
  check('the appended lines pass finding.mjs validate (they came through its door)', lint.status === 0, lint.stdout + lint.stderr);
  check('a finding came back open: exit 3', r.code === 3, `${r.code} ${r.err}`);
  check('the summary line counts', /^VERIFY: 5 resolved, 4 open, 11 not judged, 2 need a person or its agent$/m.test(r.out), r.out);
  const runs = existsSync(join(c.root, 'data-audit', 'runs')) ? readdirSync(join(c.root, 'data-audit', 'runs')) : [];
  check('run.sh ran once, in fixture mode, and saved under OPS_ROOT', runs.length === 1, runs.join());

  const again = verify(c);
  check('a second run finds nothing left of what it judged', !again.out.includes(F.s2.id) && !again.out.includes(F.r1.id) && appended(c).length === 9, again.out);
}

// ---------- 2. an unreachable server changes nothing and says so ----------
{
  const a = fu('data-auditor', 'aud', { verify: 'S2 scheduled_in_the_past' });
  const b = fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en/news lacks "fragrance"' });
  const c = setup([a, b], { 'run.txt': '', 'run.exit': '2', 'get_en_news.txt': '', 'get_en_news.exit': '28' });
  const r = verify(c);
  check('unreachable: nothing is appended', appended(c).length === 0, JSON.stringify(appended(c)));
  check('unreachable: it says the server could not be read', /aud-\S+  the server could not be read: run\.sh exit 2/.test(r.out), r.out);
  check('unreachable: it says the page could not be read', /qa-\S+  curl on the server exit 28/.test(r.out), r.out);
  check('unreachable: exit 4', r.code === 4, `${r.code} ${r.err}`);
  check('unreachable: no connection in fixture mode', r.net === '');
  const missing = setup([b]);
  const m = verify(missing);
  check('a page with no fixture is not judged and opens no connection', appended(missing).length === 0 && /get_en_news\.txt is missing/.test(m.out) && m.net === '', m.out + m.net);
}

// ---------- 3. a dry run writes nothing ----------
{
  const a = fu('data-auditor', 'aud', { verify: 'S2' });
  const b = fu('data-auditor', 'aud', { verify: 'R1 extra_time_sum' });
  const c = setup([a, b], { 'run.txt': RUN });
  const r = verify(c, { args: ['--dry-run'] });
  check('dry run: nothing appended', appended(c).length === 0);
  check('dry run: the verdicts are printed', /would be resolved \(1\)\n  aud-\S+  data-audit/.test(r.out) && /would be open again \(1\)/.test(r.out), r.out);
  check('dry run: exit 3 still says one would be open', r.code === 3);
  const bad = verify(c, { args: ['--now'] });
  check('an unknown argument is refused with exit 1', bad.code === 1 && /unknown argument/.test(bad.err), bad.err);
  const loose = verify(c, { more: { OPS_ROOT: '' } });
  check('FMIP_FIXTURE without OPS_ROOT is refused: fixture verdicts never reach the real findings', loose.code === 1 && /without OPS_ROOT/.test(loose.err) && loose.net === '', loose.err);
}

// ---------- 4. the real path: a GET through ssh, nothing else ----------
{
  const a = fu('qa-engineer', 'qa', { verify: 'https://traveltohormuz.ir/en/news lacks "fragrance"' });
  const b = fu('qa-engineer', 'qa', { verify: '/en/news has "football news"' });
  const c = setup([a, b]);
  const response = join(c.root, 'answer.txt');
  writeFileSync(response, NEWS);
  const r = verify(c, { fixture: false, more: { SHIM_RESPONSE: fwd(response), SHIM_EXIT: '0' } });
  const calls = r.net.trim().split('\n').filter(Boolean);
  check('real path: both findings resolved', lineOf(c, a.id)?.status === 'resolved' && lineOf(c, b.id)?.status === 'resolved', r.out + r.err);
  check('real path: one page is read once', calls.length === 1, r.net);
  check(
    'real path: ssh to fmip-prod with one GET by curl on our own site, nothing else',
    calls[0] === "ssh [-o] [ConnectTimeout=20] [-o] [BatchMode=yes] [fmip-prod] [curl -s -i -m 25 --proto =https --max-redirs 0 'https://traveltohormuz.ir/en/news']",
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
