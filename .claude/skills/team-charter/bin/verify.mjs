#!/usr/bin/env node
// The post-deploy verifier (T-1896, D-457 point 6). Plain Node, no dependency.
//
//   node .claude/skills/team-charter/bin/verify.mjs             judge, then write the verdicts
//   node .claude/skills/team-charter/bin/verify.mjs --dry-run   judge and print, write nothing
//
// It reads every finding whose latest line is `fixed-unverified` (through `finding.mjs list`),
// re-runs the finding's `verify` check read-only, and appends through `finding.mjs seen` either
// `resolved`, with what it saw as the evidence, or `open`, with what it saw instead. A finding
// without `verify` is listed as "needs a person or its agent", with its owner. The coordinator runs
// it after each deploy (T-1900) and by hand; the sixteen team agents may not (team-guard.mjs).
//
// A `verify` is one of two things (the charter, "The finding format"):
//   - a data-audit invariant: its whole name ("S2 scheduled_in_the_past"), its code ("S2") or its
//     name ("scheduled_in_the_past"). It holds when its row shows 0 violations. Every invariant is
//     judged on one run of data-audit/run.sh, whose read-only session is the only way to the database.
//   - an address on our own site with one assertion: `https://traveltohormuz.ir/<path> <assertion>`
//     (a bare `/<path>` means the same site; a leading `GET` is allowed, no other method is):
//         status <code>           the answer's status code is <code>
//         has <text>              the page holds <text>
//         lacks <text>            the page does not hold <text>
//         header <name>           the answer carries the header
//         header <name>: <text>   the header's value holds <text>
//         no-header <name>        the answer does not carry the header
//     Case is ignored, quotes around <text> are dropped, and a page's text is matched both as sent
//     and with its common HTML entities decoded. Redirects are not followed. A text or header
//     assertion is judged on a 2xx answer only.
//
// How a page is read: `curl` on the server, through `ssh fmip-prod` (this PC's own link is unreliable,
// as seo-check.sh says), a GET and nothing else (no -X, no data, https only, no redirect), and only
// for an address whose host is exactly traveltohormuz.ir and whose path and query hold plain URL
// characters only, so that no text in a finding can reach the server's shell.
//
// What changes nothing, and is listed with its reason: a server that cannot be reached (run.sh fails,
// ssh or curl exits non-zero, a 5xx answer the assertion did not ask for), an invariant the run does
// not print, a verify that is not understood, an address that is not our site's, a refusal by
// finding.mjs. The finding stays `fixed-unverified` and is judged again on the next run.
//
// Fixture mode: with FMIP_FIXTURE=<dir> no connection is opened. run.sh replays <dir>/run.txt
// (T-1895), and a page is <dir>/get<path>.txt, the answer as `curl -i` prints it, with curl's exit
// code in <dir>/get<path>.exit when it is not 0; <path> is the path and query with every character
// other than a letter or a digit written `_` (/en/news is get_en_news.txt). OPS_ROOT moves the
// findings folder, as finding.mjs has it; FMIP_FIXTURE without OPS_ROOT is refused unless --dry-run,
// so a verdict on fixture data never reaches the real findings.
//
// Exit: 0 every check judged and none came back open; 3 at least one came back open; 4 none came
// back open but at least one could not be judged; 1 refused (the reason is printed).
//
// What it cannot see: an invariant counts every subject of its kind, not only the finding's, so a
// fix holds for the invariant when the whole class is clean; a page is read once, at one moment, so
// a story that comes and goes can pass on a quiet day.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const FINDING = join(here, 'finding.mjs');
const RUN_SH = join(here, '..', '..', 'data-audit', 'run.sh').replace(/\\/g, '/'); // bash reads it
const SITE = 'traveltohormuz.ir';
const SERVER = 'fmip-prod';

const EXIT_REFUSED = 1;
const EXIT_OPEN = 3;
const EXIT_NOT_JUDGED = 4;

/** A path and query that can stand between single quotes on the server's shell, and in a URL. */
const SAFE_PATH = /^\/[A-Za-z0-9._~%/-]*(\?[A-Za-z0-9._~%=&+-]*)?$/;
const INVARIANT = /^(?:([A-Z]\d{1,2}[a-z]?)(?:\s+([a-z][a-z0-9_]*))?|([a-z][a-z0-9_]*))$/;
/** One row of invariants.sql's output: check | severity | violations | sample. */
const ROW = /^([A-Z]\d{1,2}[a-z]?) ([a-z][a-z0-9_]*) \| ([a-z]+) \| (\d+) \|\s?(.*)$/;
const ADDRESS = /^(?:([A-Za-z]+)\s+)?(\/\S*|[A-Za-z][\w+.-]*:\/\/\S*)(?:\s+([\s\S]*))?$/;

class Refusal extends Error {}

// ---------- reading a verify ----------

const unquote = (s) => {
  const t = s.trim();
  return t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0] ? t.slice(1, -1) : t;
};

/** Our site's URL for an address, or why it is not one. */
function ourAddress(address) {
  let url;
  try {
    url = new URL(address, `https://${SITE}`);
  } catch {
    return { why: `"${address}" is not an address` };
  }
  if (url.protocol !== 'https:' || url.hostname !== SITE || url.port !== '') {
    return { why: `${url.protocol}//${url.host} is not our own site (only https://${SITE})` };
  }
  if (url.username !== '' || url.password !== '') return { why: 'an address with a user name in it' };
  const path = `${url.pathname}${url.search}`;
  if (!SAFE_PATH.test(path)) {
    return { why: `the path ${JSON.stringify(path)} holds a character the verifier does not send` };
  }
  return { url: `https://${SITE}${path}`, path };
}

function parseAssertion(text) {
  const t = text.trim();
  let m;
  if ((m = /^status\s+(\d{3})$/i.exec(t))) return { kind: 'status', code: Number(m[1]) };
  if ((m = /^(has|lacks)\s+(\S[\s\S]*)$/i.exec(t))) {
    const needle = unquote(m[2]);
    if (needle === '') return null;
    return { kind: m[1].toLowerCase(), text: needle };
  }
  if ((m = /^no-header\s+([A-Za-z0-9-]+)$/i.exec(t))) return { kind: 'no-header', name: m[1].toLowerCase() };
  if ((m = /^header\s+([A-Za-z0-9-]+)(?:\s*:\s*(\S[\s\S]*))?$/i.exec(t))) {
    return { kind: 'header', name: m[1].toLowerCase(), text: m[2] === undefined ? undefined : unquote(m[2]) };
  }
  return null;
}

/** What a finding's `verify` asks: { kind: 'invariant' | 'address' | 'bad', ... }. */
function parseVerify(raw) {
  const text = String(raw ?? '').trim();
  const a = ADDRESS.exec(text);
  if (a) {
    const [, method, address, rest] = a;
    if (method !== undefined && method.toUpperCase() !== 'GET') {
      return { kind: 'bad', why: `${method}: an address check is a GET and nothing else` };
    }
    const place = ourAddress(address);
    if (place.why) return { kind: 'bad', why: place.why };
    const assertion = parseAssertion(rest ?? '');
    if (assertion === null) {
      return {
        kind: 'bad',
        why: `one assertion after the address: status <code>, has <text>, lacks <text>, header <name>[: <text>] or no-header <name> (got ${JSON.stringify(rest ?? '')})`,
      };
    }
    return { kind: 'address', ...place, assertion };
  }
  const m = INVARIANT.exec(text);
  if (m) return { kind: 'invariant', code: m[1], name: m[2] ?? m[3], text };
  return {
    kind: 'bad',
    why: `neither a data-audit invariant ("S2 scheduled_in_the_past") nor an address on https://${SITE} with one assertion`,
  };
}

const describe = (a) =>
  ({
    status: () => `status ${a.code}`,
    has: () => `has ${JSON.stringify(a.text)}`,
    lacks: () => `lacks ${JSON.stringify(a.text)}`,
    header: () => `header ${a.name}${a.text === undefined ? '' : `: ${JSON.stringify(a.text)}`}`,
    'no-header': () => `no-header ${a.name}`,
  })[a.kind]();

// ---------- running the checks ----------

/** Git's bash on Windows (the five scripts' ssh and their config), plain `bash` elsewhere. */
function bash() {
  if (process.platform !== 'win32' || process.env.MSYSTEM) return 'bash';
  const git = 'C:/Program Files/Git/bin/bash.exe';
  return existsSync(git) ? git : 'bash';
}

const lastLine = (text) =>
  String(text ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .at(-1) ?? '';
const short = (text, n = 200) => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** One run of run.sh: { rows: Map<code, row> } or { why } when it could not be read. */
function runInvariants() {
  const r = spawnSync(bash(), [RUN_SH], { encoding: 'utf8', timeout: 300_000, maxBuffer: 16 << 20 });
  if (r.error) return { why: `run.sh did not run (${r.error.code ?? r.error.message})` };
  const out = `${r.stdout ?? ''}`;
  if (r.status !== 0 || /^AUDIT-(ERROR|EMPTY)/m.test(out)) {
    return {
      why: `the server could not be read: run.sh exit ${r.status ?? 'none'} (${short(lastLine(`${out}\n${r.stderr ?? ''}`) || 'no output')})`,
    };
  }
  const rows = new Map();
  for (const line of out.split(/\r?\n/)) {
    const m = ROW.exec(line.trim());
    if (m) rows.set(m[1], { code: m[1], name: m[2], severity: m[3], violations: Number(m[4]), sample: m[5].trim(), line: line.trim() });
  }
  if (rows.size === 0) return { why: `run.sh printed no invariant row (${short(lastLine(out) || 'no output')})` };
  return { rows };
}

function judgeInvariant(check, run) {
  if (run.why) return { verdict: 'not-judged', why: run.why };
  const row = check.code
    ? run.rows.get(check.code)
    : [...run.rows.values()].find((r) => r.name === check.name);
  if (!row || (check.code && check.name && row.name !== check.name)) {
    return { verdict: 'not-judged', why: `run.sh printed no invariant "${check.text}"` };
  }
  const what = `data-audit/run.sh, ${row.code} ${row.name}: ${row.violations} violation(s)`;
  if (row.violations === 0) return { verdict: 'resolved', saw: `${what}; the fix holds` };
  return { verdict: 'open', saw: `${what}${row.sample ? ` (${short(row.sample)})` : ''}; the fix does not hold` };
}

const fixtureName = (path) => `get${path.replace(/[^A-Za-z0-9]/g, '_')}`;

/** One GET: { status, headers: Map, body } or { why }. */
function get(place) {
  let raw;
  let code;
  if (process.env.FMIP_FIXTURE) {
    const base = join(process.env.FMIP_FIXTURE, fixtureName(place.path));
    if (!existsSync(`${base}.txt`)) return { why: `FMIP_FIXTURE is set and ${base}.txt is missing (no connection was opened)` };
    raw = readFileSync(`${base}.txt`, 'utf8');
    code = existsSync(`${base}.exit`) ? Number(readFileSync(`${base}.exit`, 'utf8').trim()) : 0;
  } else {
    // GET only, by construction: no method, no data, https only, no redirect. The URL was checked
    // against SAFE_PATH, so it holds no quote and stands between single quotes on the server.
    const remote = `curl -s -i -m 25 --proto =https --max-redirs 0 '${place.url}'`;
    const r = spawnSync(
      bash(),
      ['-c', `exec ssh -o ConnectTimeout=20 -o BatchMode=yes ${SERVER} "$1"`, 'verify.mjs', remote],
      { encoding: 'utf8', timeout: 90_000, maxBuffer: 32 << 20 },
    );
    if (r.error) return { why: `ssh did not run (${r.error.code ?? r.error.message})` };
    raw = r.stdout ?? '';
    code = r.status;
    if (code === 255) return { why: `the server could not be reached (ssh exit 255: ${short(lastLine(r.stderr) || 'no message')})` };
  }
  if (code !== 0) return { why: `curl on the server exit ${code}: the page could not be read` };
  return parseAnswer(raw);
}

/** `curl -i` output: the last status block before the body (a proxy's or a 1xx block is skipped). */
function parseAnswer(raw) {
  let rest = raw;
  for (;;) {
    const end = /\r?\n\r?\n/.exec(rest);
    const head = end ? rest.slice(0, end.index) : rest;
    const body = end ? rest.slice(end.index + end[0].length) : '';
    const lines = head.split(/\r?\n/);
    const m = /^HTTP\/[\d.]+\s+(\d{3})/.exec(lines[0] ?? '');
    if (!m) return { why: 'the answer has no status line' };
    const status = Number(m[1]);
    if ((status < 200 || /connection established/i.test(lines[0])) && /^HTTP\//.test(body)) {
      rest = body;
      continue;
    }
    const headers = new Map();
    for (const line of lines.slice(1)) {
      const at = line.indexOf(':');
      if (at > 0) headers.set(line.slice(0, at).trim().toLowerCase(), line.slice(at + 1).trim());
    }
    return { status, headers, body };
  }
}

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(n) && n <= 0x10ffff ? String.fromCodePoint(n) : all;
    }
    return ENTITIES[e.toLowerCase()] ?? all;
  });
const holds = (body, text) => {
  const t = text.toLowerCase();
  return body.toLowerCase().includes(t) || decode(body).toLowerCase().includes(t);
};

function judgeAddress(check, answer) {
  const a = check.assertion;
  const what = `GET ${check.url} (curl on the server)`;
  if (answer.why) return { verdict: 'not-judged', why: answer.why };
  const status = answer.status;
  if (a.kind === 'status') {
    if (status === a.code) return { verdict: 'resolved', saw: `${what}: HTTP ${status}, as asked; the fix holds` };
    if (status >= 500) return { verdict: 'not-judged', why: `the site answered HTTP ${status}, not ${a.code}; judged again on the next run` };
    return { verdict: 'open', saw: `${what}: HTTP ${status}, not ${a.code}; the fix does not hold` };
  }
  if (status < 200 || status > 299) {
    return { verdict: 'not-judged', why: `the site answered HTTP ${status}: a ${a.kind} assertion is judged on a 2xx answer only` };
  }
  const size = `HTTP ${status}, ${Buffer.byteLength(answer.body)} bytes`;
  if (a.kind === 'has' || a.kind === 'lacks') {
    const found = holds(answer.body, a.text);
    const pass = a.kind === 'has' ? found : !found;
    const seen = `${what}: ${size}; the page ${found ? 'holds' : 'does not hold'} ${JSON.stringify(a.text)}`;
    return pass ? { verdict: 'resolved', saw: `${seen}; the fix holds` } : { verdict: 'open', saw: `${seen}; the fix does not hold` };
  }
  const value = answer.headers.get(a.name);
  if (a.kind === 'no-header') {
    return value === undefined
      ? { verdict: 'resolved', saw: `${what}: ${size}; no ${a.name} header; the fix holds` }
      : { verdict: 'open', saw: `${what}: ${size}; the ${a.name} header is there (${JSON.stringify(short(value, 120))}); the fix does not hold` };
  }
  if (value === undefined) return { verdict: 'open', saw: `${what}: ${size}; no ${a.name} header; the fix does not hold` };
  if (a.text === undefined || value.toLowerCase().includes(a.text.toLowerCase())) {
    return { verdict: 'resolved', saw: `${what}: ${size}; ${a.name}: ${JSON.stringify(short(value, 120))}; the fix holds` };
  }
  return {
    verdict: 'open',
    saw: `${what}: ${size}; ${a.name}: ${JSON.stringify(short(value, 120))}, without ${JSON.stringify(a.text)}; the fix does not hold`,
  };
}

// ---------- the findings ----------

function node(args) {
  return spawnSync(process.execPath, [FINDING, ...args], { encoding: 'utf8', maxBuffer: 64 << 20 });
}

function waiting() {
  const r = node(['list', '--status', 'fixed-unverified']);
  if (r.status !== 0) throw new Refusal(`finding.mjs list failed: ${lastLine(r.stderr) || r.status}`);
  return JSON.parse(r.stdout).sort(
    (a, b) => String(a.first_seen).localeCompare(String(b.first_seen)) || a.id.localeCompare(b.id),
  );
}

/** Appends the verdict through the one door; null when written, else finding.mjs's reason. */
function write(id, status, evidence) {
  const dir = mkdtempSync(join(tmpdir(), 'verify-'));
  try {
    const file = join(dir, 'evidence.txt');
    writeFileSync(file, evidence);
    const r = node(['seen', id, '--status', status, '--evidence-file', file]);
    return r.status === 0 ? null : lastLine(r.stderr) || `exit ${r.status}`;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A security finding's title stays on this computer (the charter, T-1879): id, severity, owner only. */
const label = (f) =>
  f.agent === 'security' || String(f.id).startsWith('sec-') ? '(a security finding: its title is not shown here)' : JSON.stringify(f.title);

// ---------- main ----------

function main(argv) {
  const dry = argv.includes('--dry-run');
  if (argv.some((a) => a === '--help' || a === 'help')) {
    process.stdout.write(
      'verify.mjs (T-1896): re-runs the verify check of every fixed-unverified finding and appends resolved or open through finding.mjs.\n  [--dry-run]   judge and print, write nothing\nThe grammar of a check is in this file\'s header.\n',
    );
    return 0;
  }
  const unknown = argv.filter((a) => a !== '--dry-run');
  if (unknown.length > 0) throw new Refusal(`unknown argument ${JSON.stringify(unknown[0])} (only --dry-run)`);
  if (process.env.FMIP_FIXTURE && !process.env.OPS_ROOT && !dry) {
    throw new Refusal('FMIP_FIXTURE without OPS_ROOT would write verdicts on fixture data into the real findings: set OPS_ROOT to a temp folder, or give --dry-run');
  }

  const findings = waiting();
  const checks = findings.map((f) => ({ f, check: f.verify === undefined ? null : parseVerify(f.verify) }));
  const run = checks.some((c) => c.check?.kind === 'invariant') ? runInvariants() : null;
  const pages = new Map();
  const groups = { resolved: [], open: [], 'not-judged': [], person: [] };
  const stamp = `${new Date().toISOString().slice(0, 16)}Z`;

  for (const { f, check } of checks) {
    if (check === null) {
      groups.person.push(`${f.id}  owner ${f.owner}  ${f.severity}  ${label(f)}`);
      continue;
    }
    let result;
    if (check.kind === 'bad') result = { verdict: 'not-judged', why: `verify ${JSON.stringify(f.verify)} is not understood: ${check.why}` };
    else if (check.kind === 'invariant') result = judgeInvariant(check, run);
    else {
      if (!pages.has(check.url)) pages.set(check.url, get(check));
      result = judgeAddress(check, pages.get(check.url));
    }
    if (result.verdict === 'not-judged') {
      groups['not-judged'].push(`${f.id}  ${result.why}`);
      continue;
    }
    const shown = check.kind === 'invariant' ? check.text : `${check.url} ${describe(check.assertion)}`;
    if (!dry) {
      const refused = write(f.id, result.verdict, `verify.mjs (T-1896) ${stamp}, check: ${shown}. Seen: ${result.saw}.`);
      if (refused !== null) {
        groups['not-judged'].push(`${f.id}  ${result.verdict}, but finding.mjs refused the line: ${refused}`);
        continue;
      }
    }
    groups[result.verdict].push(`${f.id}  ${result.saw}`);
  }

  const out = [
    `verify.mjs (T-1896) ${stamp}: ${findings.length} finding(s) fixed-unverified, ${checks.filter((c) => c.check !== null).length} with a verify check${dry ? ' (dry run: nothing written)' : ''}`,
  ];
  const section = (title, lines) => {
    out.push(`${title} (${lines.length})`);
    for (const line of lines) out.push(`  ${line}`);
  };
  section(dry ? 'would be resolved' : 'resolved', groups.resolved);
  section(dry ? 'would be open again' : 'open again', groups.open);
  section('not judged, nothing changed', groups['not-judged']);
  section('needs a person or its agent (no verify)', groups.person);
  out.push(
    `VERIFY: ${groups.resolved.length} resolved, ${groups.open.length} open, ${groups['not-judged'].length} not judged, ${groups.person.length} need a person or its agent${dry ? ' (dry run)' : ''}`,
  );
  process.stdout.write(`${out.join('\n')}\n`);
  if (groups.open.length > 0) return EXIT_OPEN;
  if (groups['not-judged'].length > 0) return EXIT_NOT_JUDGED;
  return 0;
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  process.stderr.write(`verify.mjs: ${error.message}\n`);
  process.exitCode = EXIT_REFUSED;
}
