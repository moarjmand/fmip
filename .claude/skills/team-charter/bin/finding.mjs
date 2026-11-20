#!/usr/bin/env node
// The one door for the agent team's findings (T-1884, D-457 point 2). Plain Node, no dependency.
//
//   node .claude/skills/team-charter/bin/finding.mjs add ...        a new finding; prints the id it was given
//   node .claude/skills/team-charter/bin/finding.mjs seen <id> ...  a finding seen again, or its status changed
//   node .claude/skills/team-charter/bin/finding.mjs validate [<file>...]   lint; `check` is the same on every file
//   node .claude/skills/team-charter/bin/finding.mjs list ...       the latest state of each finding, as JSON
//   node .claude/skills/team-charter/bin/finding.mjs help
//
// The files are E:/FMIP/ops/findings/<YYYY-MM-DD>.jsonl (UTC), one JSON object per line, append
// only: a change of status is a new line with the same id. The folder is $OPS_ROOT/findings, so a
// test or an eval points OPS_ROOT at a temp folder and never touches the real one.
//
// What it does that a heredoc could not: the twelve required fields and their vocabularies are
// checked; the id is allocated here, for the agent and the UTC date, while holding a lock (`mkdir`
// on findings/.lock, retried), so two agents running at once never share one; the line is written
// with JSON.stringify, so a quote or a backslash in the text cannot break it; `fixed` is taken as
// `fixed-unverified`; a secret-shaped string and the severity `info` are refused; and before a new
// finding is filed the open ones are searched for the same subject.
//
// What it cannot see, as guard.mjs says of itself: it is a door, not a wall. A line written by hand
// with a heredoc bypasses it until the team guard refuses that (T-1885), which is why `validate`
// exists. The same-subject search compares title words only: two findings about one problem in
// different words pass it. The lock is advisory: only callers of this script honour it. `--by` is
// a name the caller types, not a sign-in: it stops an agent closing a finding as a person by
// habit, not one that sets out to. Git Bash rewrites an argument that begins with a slash before
// Node sees it; what can be recognised is put back or refused, but a path after `=` inside a longer
// text (`x=/e/y` arriving as `x=E:/y`) cannot be told from a real one: text with slashes goes in a file.
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  statSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';

/** Agent -> id prefix (the charter's list). The chief of staff coordinates and files none. */
const PREFIX = {
  'ops-release': 'ops',
  'qa-engineer': 'qa',
  'code-reviewer': 'rev',
  'data-auditor': 'aud',
  designer: 'des',
  security: 'sec',
  architect: 'arc',
  'model-scientist': 'mod',
  'product-strategist': 'str',
  'content-community': 'cnt',
  'business-adviser': 'biz',
  'marketing-manager': 'mkt',
  'seo-search': 'seo',
  'social-media': 'soc',
  'growth-analyst': 'gro',
};
const AGENTS = [...Object.keys(PREFIX), 'chief-of-staff'];
const OWNERS = ['maintainer', 'engineering-session', ...AGENTS];
const SEVERITIES = ['critical', 'major', 'minor', 'info']; // `info` is read in old lines, never filed (D-457 point 7)
const CONFIDENCES = ['high', 'medium', 'low'];
/** The status vocabulary of D-457, written once. */
const OPEN = ['new', 'open', 'decide'];
const WAITING = ['fixed-unverified', 'planned', 'snoozed'];
const CLOSED = ['resolved', 'accepted', 'rejected', 'duplicate', 'stale'];
const STATUSES = [...OPEN, ...WAITING, ...CLOSED];
/** A person's triage (D-457 point 2, D-456 point 2): never an agent's own word, so they name who. */
const PERSON_STATUSES = ['planned', 'rejected', 'snoozed'];
/**
 * A minor finding with no line for this many days may be closed as `stale` (D-457 point 7).
 * The number is proposed and awaits the maintainer's confirmation: change it here only.
 */
const STALE_AFTER_DAYS = 14;
const REQUIRED = [
  'id',
  'agent',
  'severity',
  'visible_to_users',
  'title',
  'evidence',
  'likely_cause',
  'proposal',
  'owner',
  'confidence',
  'status',
  'first_seen',
];
const TEXT_FIELDS = ['title', 'evidence', 'likely_cause', 'proposal'];
/** Optional fields a line may carry (D-457 point 2), plus the two a status needs. */
const OPTIONAL_TEXT = ['verify', 'report', 'quoted', 'task', 'duplicate_of', 'until', 'by'];
const CARRIED = ['verify', 'report', 'quoted', 'task', 'public'];
/** Who a line is by, when a person decided it: one short word that is not an agent's name. */
const BY_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;

const ID_RE = new RegExp(
  `^(${Object.values(PREFIX).join('|')})-(\\d{4}-\\d{2}-\\d{2})-(\\d{2,3})$`,
);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
/** The two ids filed outside the scheme before this script existed: left as they are and listed (T-1884). */
const LEGACY_IDS = new Set(['ops-2026-11-01-reboot', 'aud-2026-11-17-dup-persons-01']);
/**
 * The three lines written by hand without `first_seen` before this script existed, by file, line
 * and id. They are never rewritten (the one in-place repair of D-457 is the three lines that did
 * not parse), so `validate` lists them as known instead of failing on them for ever. Any other
 * line missing a field is an error.
 */
const LEGACY_NO_FIRST_SEEN = new Map([
  ['2026-11-04.jsonl:5', 'cnt-2026-11-04-02'],
  ['2026-11-04.jsonl:6', 'cnt-2026-11-04-03'],
  ['2026-11-04.jsonl:7', 'cnt-2026-11-02-01'],
]);
/** A lock this old belongs to a process that died. The wait for the lock is longer than this. */
const LOCK_STALE_MS = 30_000;
const LOCK_WAIT_MS = 45_000;
/** Title-word similarity at or above which two findings are taken as one subject (the audit's measure). */
const SAME_SUBJECT = 0.45;
/** Below this, a later line's title shares almost nothing with the id's earlier titles. */
const TITLE_REPLACED = 0.15;
const TITLE_MAX = 300;

const EXIT_REFUSED = 1;
const EXIT_SAME_SUBJECT = 3;

/**
 * Secret shapes. The match is never printed, only the name of the shape. Where a shape has a
 * capture group, the group is the value, and a value that only stands for a secret (a mask, a date
 * and time) is let through: `postgres://fmip:****@db` and `password_changed_at: 2026-11-19T10:00:00Z`
 * are evidence, not secrets.
 */
const SECRET_SHAPES = [
  ['a private key block', /-----BEGIN [A-Z ]*PRIVATE KEY-----/g],
  ['an API key (sk-...)', /\bsk-[A-Za-z0-9_-]{20,}/g],
  ['a GitHub token', /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,})/g],
  ['an AWS access key id', /\bAKIA[0-9A-Z]{16}\b/g],
  ['a Google API key', /\bAIza[0-9A-Za-z_-]{35}\b/g],
  ['a Slack token', /\bxox[abprs]-[A-Za-z0-9-]{10,}/g],
  ['a JSON web token', /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g],
  // a token holds digits as well as letters; "Bearer authorization/required/for/all/routes" is prose
  [
    'a bearer token',
    /\bBearer\s+(?=[A-Za-z0-9._~+/=-]*\d)(?=[A-Za-z0-9._~+/=-]*[A-Za-z])([A-Za-z0-9._~+/=-]{20,})/gi,
  ],
  ['a URL with a password in it', /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:([^\s/@]{3,})@/gi],
  // name = value, where the value is one long word holding both letters and digits
  [
    'a password, token or key with its value',
    /(?:password|passwd|secret|token|api[_-]?key)[\w-]*["']?\s*[=:]\s*["']?(?=[^\s"']*\d)(?=[^\s"']*[A-Za-z])([^\s"']{12,})/gi,
  ],
];

/** A value that stands for a secret without being one: a mask, a placeholder, or a date and time. */
function standsForASecret(value) {
  const v = value.replace(/[,;.)\]]+$/, '');
  return (
    /^[*•#xX._-]+$/.test(v) ||
    /^<[^>]*>$/.test(v) ||
    /^(?:\[?(?:redacted|masked|hidden|removed|omitted)\]?)$/i.test(v) ||
    /^\d{4}-\d{2}-\d{2}(?:[T_]?\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(v)
  );
}

class Refusal extends Error {
  constructor(message, code = EXIT_REFUSED) {
    super(message);
    this.code = code;
  }
}
const refuse = (message, code) => {
  throw new Refusal(message, code);
};

// ---------- small helpers ----------

/** Git Bash hands Node `/e/FMIP/...` untouched when its path conversion is off. */
function nativePath(p) {
  const m = process.platform === 'win32' ? /^\/([a-zA-Z])\/(.*)$/.exec(p) : null;
  return m ? `${m[1].toUpperCase()}:/${m[2]}` : p;
}

const findingsDir = () => join(nativePath(process.env.OPS_ROOT || 'E:/FMIP/ops'), 'findings');

/** The UTC date. FINDING_TODAY fixes the clock for a test. */
function today() {
  const fixed = process.env.FINDING_TODAY;
  if (fixed) {
    if (!validDate(fixed)) refuse(`FINDING_TODAY is not a date: ${fixed}`);
    return fixed;
  }
  return new Date().toISOString().slice(0, 10);
}

function validDate(s) {
  return (
    typeof s === 'string' &&
    DATE_RE.test(s) &&
    !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) &&
    new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s
  );
}

const daysBetween = (from, to) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

const titleWords = (title) =>
  new Set(
    (
      String(title)
        .toLowerCase()
        .match(/[\p{L}\p{N}]+/gu) ?? []
    ).filter((w) => w.length >= 2),
  );

/** Jaccard similarity of two titles' word sets, 0 to 1. */
function similarity(a, b) {
  const wa = titleWords(a);
  const wb = titleWords(b);
  let shared = 0;
  for (const w of wa) if (wb.has(w)) shared += 1;
  const union = wa.size + wb.size - shared;
  return union === 0 ? 0 : shared / union;
}

function secretShape(text) {
  for (const [name, re] of SECRET_SHAPES) {
    for (const m of text.matchAll(re)) {
      if (m[1] === undefined || !standsForASecret(m[1])) return name;
    }
  }
  return null;
}

/** `fixed` is read as `fixed-unverified` (D-457 point 2). */
const readStatus = (status) => (status === 'fixed' ? 'fixed-unverified' : status);

function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const ageMs = (path) => Date.now() - statSync(path).mtimeMs;
/** What tells one lock folder from the next one made under the same name. */
const lockMark = (path) => {
  const s = statSync(path, { bigint: true });
  return `${s.ino}:${s.birthtimeNs}`;
};

/**
 * Clears a lock left by a process that died, so that one waiter does it and no waiter can remove
 * a lock that is alive. Two waiters that both saw the old lock must not both remove "the lock":
 * the second would remove the fresh one the first has just taken. So the clearing itself is done
 * under a second `mkdir`, `.lock.clearing`: whoever holds it looks at the lock again, and only if
 * it is still the old one moves it aside in one step (`rename`) and removes it there. Everyone,
 * the clearer included, then takes the lock through the same `mkdir` as always.
 */
function clearDeadLock(lock) {
  const clearing = `${lock}.clearing`;
  try {
    mkdirSync(clearing);
  } catch {
    try {
      // another waiter is clearing; a `.clearing` this old was left by one that died in the act
      if (ageMs(clearing) > LOCK_STALE_MS) rmdirSync(clearing);
    } catch {
      // gone already
    }
    return;
  }
  try {
    if (ageMs(lock) > LOCK_STALE_MS) {
      const aside = `${lock}.dead-${process.pid}-${Date.now()}`;
      renameSync(lock, aside);
      rmdirSync(aside);
    }
  } catch {
    // released, or already cleared, between the look and the move: nothing to clear
  } finally {
    try {
      rmdirSync(clearing);
    } catch {
      // gone already
    }
  }
}

/**
 * Runs `work` while holding findings/.lock. `mkdir` either creates the folder or fails, in one step,
 * on every file system this runs on, so two processes never both hold it. A lock older than
 * LOCK_STALE_MS belongs to a process that died and is cleared (see clearDeadLock).
 */
function withLock(dir, work) {
  mkdirSync(dir, { recursive: true });
  const lock = join(dir, '.lock');
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if (error.code !== 'EEXIST' && error.code !== 'EPERM' && error.code !== 'EACCES') throw error;
      let dead = false;
      try {
        dead = ageMs(lock) > LOCK_STALE_MS;
      } catch {
        // released between the two calls: try again
      }
      if (dead) clearDeadLock(lock);
      if (Date.now() > deadline) {
        refuse(`could not take the lock ${lock} in ${LOCK_WAIT_MS / 1000} s; nothing was written`);
      }
      sleep(15 + Math.floor(Math.random() * 45));
    }
  }
  let mine = null;
  try {
    mine = lockMark(lock);
  } catch {
    // cannot be read: then it is not removed below either
  }
  try {
    return work();
  } finally {
    try {
      // only the lock this process made: if it was held so long that it was cleared as dead,
      // the folder under this name is now someone else's
      if (mine !== null && lockMark(lock) === mine) rmdirSync(lock);
    } catch {
      // already gone
    }
  }
}

// ---------- reading ----------

/**
 * Every line of every findings file in `dir`, oldest file first. A line is
 * { file, n, raw, obj } or { file, n, raw, error } when it does not parse.
 */
function readFolder(dir) {
  if (!existsSync(dir)) return [];
  const lines = [];
  const names = readdirSync(dir)
    .filter((name) => name.endsWith('.jsonl'))
    .sort();
  for (const name of names) {
    const rows = readFileSync(join(dir, name), 'utf8')
      .replace(/^\uFEFF/, '')
      .split('\n');
    if (rows.at(-1) === '') rows.pop();
    rows.forEach((row, index) => {
      const raw = row.replace(/\r$/, '');
      const line = { file: name, n: index + 1, raw };
      if (raw.trim() === '') line.blank = true;
      else {
        try {
          line.obj = JSON.parse(raw);
        } catch (error) {
          line.error = error.message;
        }
      }
      lines.push(line);
    });
  }
  return lines;
}

/** id -> its lines in the order they were written. */
function histories(lines) {
  const byId = new Map();
  for (const line of lines) {
    const id = line.obj && typeof line.obj === 'object' ? line.obj.id : undefined;
    if (typeof id !== 'string') continue;
    if (!byId.has(id)) byId.set(id, []);
    byId.get(id).push(line);
  }
  return byId;
}

// ---------- the rules of one line ----------

/** What is wrong with one parsed line by itself: [{ level, code, message }]. */
function lineProblems(o) {
  const out = [];
  const error = (code, message) => out.push({ level: 'error', code, message });
  const warning = (code, message) => out.push({ level: 'warning', code, message });
  if (o === null || typeof o !== 'object' || Array.isArray(o)) {
    error('not-an-object', 'the line is JSON but not an object');
    return out;
  }
  const missing = REQUIRED.filter((key) => !(key in o));
  if (missing.length > 0)
    error('missing-field', `missing ${missing.map((k) => `\`${k}\``).join(', ')}`);
  for (const key of TEXT_FIELDS) {
    if (key in o && (typeof o[key] !== 'string' || o[key].trim() === ''))
      error('empty-field', `\`${key}\` must be a text that is not empty`);
  }
  if ('visible_to_users' in o && typeof o.visible_to_users !== 'boolean')
    error('bad-value', '`visible_to_users` must be true or false');
  const known = (key, list) => {
    if (key in o && !list.includes(o[key]))
      error(
        `unknown-${key}`,
        `unknown ${key} ${JSON.stringify(o[key])} (one of: ${list.join(', ')})`,
      );
  };
  known('agent', AGENTS);
  known('severity', SEVERITIES);
  known('owner', OWNERS);
  known('confidence', CONFIDENCES);
  if (o.status === 'fixed') warning('status-fixed', 'status "fixed" is read as "fixed-unverified"');
  else known('status', STATUSES);
  if ('id' in o) {
    const m = typeof o.id === 'string' ? ID_RE.exec(o.id) : null;
    if (m) {
      if (!validDate(m[2])) error('id-out-of-scheme', `the date in the id ${o.id} is not a date`);
      if (PREFIX[o.agent] && PREFIX[o.agent] !== m[1])
        error(
          'id-agent-mismatch',
          `the id ${o.id} does not carry ${o.agent}'s prefix \`${PREFIX[o.agent]}\``,
        );
    } else if (LEGACY_IDS.has(o.id)) {
      warning(
        'id-out-of-scheme',
        `the id ${o.id} is outside the scheme <prefix>-YYYY-MM-DD-NN; kept as it is (T-1884)`,
      );
    } else {
      error(
        'id-out-of-scheme',
        `the id ${JSON.stringify(o.id)} is outside the scheme <prefix>-YYYY-MM-DD-NN`,
      );
    }
  }
  if ('first_seen' in o && !validDate(o.first_seen))
    error('bad-value', '`first_seen` must be a date, YYYY-MM-DD');
  for (const key of OPTIONAL_TEXT) {
    if (key in o && (typeof o[key] !== 'string' || o[key].trim() === ''))
      error('bad-value', `\`${key}\` must be a text that is not empty`);
  }
  if ('public' in o && typeof o.public !== 'boolean')
    error('bad-value', '`public` must be true or false');
  if (o.status === 'duplicate' && typeof o.duplicate_of !== 'string')
    error('missing-field', 'a `duplicate` names the finding it repeats in `duplicate_of`');
  if (o.status === 'snoozed' && !validDate(o.until))
    error('missing-field', 'a `snoozed` finding carries the date it wakes in `until`');
  if ('until' in o && typeof o.until === 'string' && !validDate(o.until))
    error('bad-value', '`until` must be a date, YYYY-MM-DD');
  if (typeof o.by === 'string' && !BY_RE.test(o.by)) error('bad-value', '`by` is one short name');
  if (PERSON_STATUSES.includes(o.status)) {
    if (typeof o.by !== 'string') {
      error(
        'missing-field',
        `\`${o.status}\` is a person's decision: the line names whose in \`by\``,
      );
    } else if (AGENTS.includes(o.by)) {
      error('bad-value', `\`${o.status}\` is a person's decision, and \`by\` names an agent`);
    }
  }
  for (const [key, value] of Object.entries(o)) {
    const shape = typeof value === 'string' ? secretShape(value) : null;
    if (shape)
      error(
        'secret-shaped',
        `\`${key}\` holds what looks like ${shape}: say what it is, never the value`,
      );
  }
  return out;
}

/** What is wrong with a line given the lines before it with the same id. */
function historyProblems(line, earlier) {
  if (earlier.length === 0 || typeof line.obj.title !== 'string') return [];
  const first = earlier[0];
  const where = `${first.file}:${first.n}`;
  const titles = earlier.map((l) => l.obj.title).filter((t) => typeof t === 'string');
  if (titles.length === 0) return [];
  const closest = Math.max(...titles.map((t) => similarity(t, line.obj.title)));
  if (line.obj.status === 'new') {
    const other = similarity(first.obj.title, line.obj.title) < SAME_SUBJECT;
    return [
      {
        level: 'warning',
        code: other ? 'id-reused' : 'id-filed-twice',
        message: other
          ? `the id ${line.obj.id} is filed as new again, for another subject; it was first filed at ${where} as ${JSON.stringify(first.obj.title)}`
          : `the id ${line.obj.id} is filed as new again (first at ${where})`,
      },
    ];
  }
  if (closest < TITLE_REPLACED) {
    return [
      {
        level: 'warning',
        code: 'title-replaced',
        message: `the title shares almost no word with the earlier titles of ${line.obj.id} (first at ${where}: ${JSON.stringify(first.obj.title)}): a re-title, or the id used for another subject`,
      },
    ];
  }
  return [];
}

// ---------- the command line ----------

const FLAGS = new Set(['new', 'json', 'help']);
const FILE_TEXT = ['title', 'evidence', 'cause', 'proposal', 'quoted'];

function parseArgs(argv, allowed) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--') || arg === '--') {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf('=');
    const key = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (key === 'id')
      refuse(
        'an id is never chosen by hand: `add` allocates it, and `seen` takes the id as its first word',
      );
    if (!allowed.includes(key))
      refuse(
        `unknown option --${key} (this command takes: ${allowed.map((k) => `--${k}`).join(' ')})`,
      );
    if (key in options) refuse(`--${key} is given twice`);
    if (FLAGS.has(key)) {
      options[key] = true;
      continue;
    }
    const value = eq === -1 ? argv[(i += 1)] : arg.slice(eq + 1);
    if (value === undefined) refuse(`--${key} needs a value`);
    options[key] = value;
  }
  return { positional, options };
}

/**
 * Git Bash rewrites an argument that begins with a slash into a Windows path before Node sees it.
 * Only one shape can be put back without guessing: "/en/news shows ..." arrives as
 * "<Git's folder>/en/news shows ...", and no finding begins with Git's folder. Everything else that
 * looks rewritten is refused, with the way round it, instead of being guessed at:
 *   - Git's folder anywhere else in the text ("x=/en/news", "(/en/news)", a path list);
 *   - a text that begins with a drive path: "/e/FMIP/x" arrives as "E:/FMIP/x" and "/a:/b" as
 *     "a:/b", which cannot be told from a text that really begins with one.
 */
function unmangle(name, value) {
  if (process.platform !== 'win32' || !(process.env.EXEPATH || process.env.MSYSTEM)) return value;
  const way = FILE_TEXT.includes(name)
    ? `put the text in a file and give --${name}-file`
    : 'word it so that it does not begin with a slash or a path';
  const root = (process.env.EXEPATH ?? '')
    .replace(/\\/g, '/')
    .replace(/\/(usr\/bin|mingw64\/bin|bin)\/?$/i, '')
    .toLowerCase();
  let out = value;
  if (root !== '') {
    const lower = value.toLowerCase();
    const at = lower.indexOf(root);
    const backslashed = lower.includes(root.replace(/\//g, '\\'));
    const plainStart = at === 0 && lower[root.length] === '/' && lower.indexOf(root, 1) === -1;
    if (backslashed || (at !== -1 && !plainStart)) {
      refuse(`--${name} held a slash-led path and the shell rewrote it as a Windows path; ${way}`);
    }
    if (plainStart) out = value.slice(root.length);
  }
  if (/^[A-Za-z]:[\\/]/.test(out)) {
    refuse(
      `--${name} begins with a drive path, which is also what the shell makes of a leading slash ("/e/x" arrives as "E:/x"), so what was typed cannot be told; ${way}`,
    );
  }
  return out;
}

/** The text of --name or of the file --name-file names; never both. */
function text(options, name) {
  const direct = options[name];
  const file = options[`${name}-file`];
  if (direct !== undefined && file !== undefined)
    refuse(`give --${name} or --${name}-file, not both`);
  let value;
  if (file !== undefined) {
    try {
      value = readFileSync(nativePath(file), 'utf8').replace(/^\uFEFF/, '');
    } catch (error) {
      refuse(`--${name}-file: cannot read ${file} (${error.code ?? error.message})`);
    }
  } else if (direct !== undefined) {
    value = unmangle(name, direct);
  } else {
    return undefined;
  }
  value = value.replace(/\r\n/g, '\n').trim();
  if (typeof value.toWellFormed === 'function') value = value.toWellFormed();
  if (value === '') refuse(`--${name} is empty`);
  return value;
}

function oneOf(options, name, list, required) {
  const value = options[name];
  if (value === undefined) {
    if (required) refuse(`missing --${name} (one of: ${list.join(', ')})`);
    return undefined;
  }
  if (!list.includes(value)) refuse(`unknown ${name} "${value}" (one of: ${list.join(', ')})`);
  return value;
}

function truth(options, name, required) {
  const value = options[name];
  if (value === undefined) {
    if (required) refuse(`missing --${name} (true or false)`);
    return undefined;
  }
  if (value !== 'true' && value !== 'false') refuse(`--${name} is true or false, not "${value}"`);
  return value === 'true';
}

function title(options, required) {
  const value = text(options, 'title');
  if (value === undefined) {
    if (required) refuse('missing --title');
    return undefined;
  }
  if (value.includes('\n')) refuse('--title is one line');
  if (value.length > TITLE_MAX)
    refuse(
      `--title is ${value.length} characters; keep it under ${TITLE_MAX} and put the rest in the evidence`,
    );
  return value;
}

/** A finding seen at all is at least `minor`: `info` belongs in the report. */
function severity(options, required) {
  if (options.severity === 'info') {
    refuse(
      '`info` is not filed as a finding: it goes in your report, and an "all green" line is never a finding (D-457 point 7)',
    );
  }
  return oneOf(options, 'severity', ['critical', 'major', 'minor'], required);
}

function optionalFields(options, line) {
  for (const key of ['verify', 'report', 'task']) {
    if (options[key] === undefined) continue;
    // `report` is a path, and a path is what the shell is right to rewrite
    const value = (
      key === 'report' ? nativePath(options[key]) : unmangle(key, options[key])
    ).trim();
    if (value === '') refuse(`--${key} is empty`);
    line[key] = value;
  }
  const quoted = text(options, 'quoted');
  if (quoted !== undefined) line.quoted = quoted;
}

/** Key order of the charter, then the optional fields. */
function ordered(line) {
  const out = {};
  for (const key of [
    ...REQUIRED,
    'verify',
    'report',
    'quoted',
    'task',
    'public',
    'duplicate_of',
    'until',
    'by',
  ])
    if (key in line) out[key] = line[key];
  return out;
}

function refuseIfInvalid(line) {
  const errors = lineProblems(line).filter((p) => p.level === 'error');
  if (errors.length > 0) refuse(`not written:\n${errors.map((p) => `  ${p.message}`).join('\n')}`);
}

/** Appends one line to the day's file. Called while holding the lock. */
function append(dir, date, line) {
  const file = join(dir, `${date}.jsonl`);
  const before = existsSync(file) ? readFileSync(file, 'utf8') : '';
  const gap = before !== '' && !before.endsWith('\n') ? '\n' : ''; // a hand-written file may lack its last newline
  appendFileSync(file, `${gap}${JSON.stringify(ordered(line))}\n`);
}

// ---------- add ----------

const ADD_OPTIONS = [
  'agent',
  'severity',
  'visible',
  'title',
  'title-file',
  'evidence',
  'evidence-file',
  'cause',
  'cause-file',
  'proposal',
  'proposal-file',
  'owner',
  'confidence',
  'status',
  'verify',
  'report',
  'quoted',
  'quoted-file',
  'task',
  'new',
];

function add(argv) {
  const { positional, options } = parseArgs(argv, ADD_OPTIONS);
  if (positional.length > 0)
    refuse(`add takes options only, not "${positional[0]}"; the id is allocated by the script`);
  const agent = oneOf(options, 'agent', AGENTS, true);
  if (!PREFIX[agent]) refuse(`${agent} files no findings (the charter gives it no id prefix)`);
  const line = {
    agent,
    severity: severity(options, true),
    visible_to_users: truth(options, 'visible', true),
    title: title(options, true),
    evidence: text(options, 'evidence') ?? refuse('missing --evidence or --evidence-file'),
    likely_cause: text(options, 'cause') ?? refuse('missing --cause (say "unknown" when it is)'),
    proposal: text(options, 'proposal') ?? refuse('missing --proposal'),
    owner: oneOf(options, 'owner', OWNERS, true),
    confidence: oneOf(options, 'confidence', CONFIDENCES, true),
    status: oneOf(options, 'status', ['new', 'decide'], false) ?? 'new',
  };
  optionalFields(options, line);
  const date = today();
  line.first_seen = date;
  // everything that can be judged without the files is judged before the lock is taken
  refuseIfInvalid({ ...line, id: `${PREFIX[agent]}-${date}-00` });
  const dir = findingsDir();
  return withLock(dir, () => {
    const lines = readFolder(dir);
    const byId = histories(lines);
    if (!options.new) {
      const matches = sameSubject(byId, line.title, date);
      if (matches.length > 0) {
        refuse(
          [
            `Not added: ${matches.length} open finding(s) look like the same subject (title-word similarity ${SAME_SUBJECT} or more).`,
            ...matches.map(
              (m) =>
                `  ${m.id}  ${m.status}  ${m.similarity.toFixed(2)}  ${m.agent}  ${JSON.stringify(m.title)}`,
            ),
            'If it is one of them:   finding.mjs seen <id> --status open --evidence-file <file>',
            'If it is another subject: repeat the same command with --new',
          ].join('\n'),
          EXIT_SAME_SUBJECT,
        );
      }
    }
    line.id = nextId(byId, PREFIX[agent], date);
    refuseIfInvalid(line);
    append(dir, date, line);
    return line.id;
  });
}

/** The next free <prefix>-<date>-NN: one more than the highest any file holds. */
function nextId(byId, prefix, date) {
  let highest = 0;
  for (const id of byId.keys()) {
    const m = ID_RE.exec(id);
    if (m && m[1] === prefix && m[2] === date) highest = Math.max(highest, Number(m[3]));
  }
  if (highest >= 999) refuse(`${prefix} has used every id of ${date}`);
  return `${prefix}-${date}-${String(highest + 1).padStart(2, '0')}`;
}

/** Latest status of a finding as it reads on `date`: a snooze that has run out is open again. */
function statusOn(obj, date) {
  const status = readStatus(obj.status);
  return status === 'snoozed' && validDate(obj.until) && obj.until <= date ? 'open' : status;
}

/**
 * Findings still alive whose title, now or earlier, is the same subject. `stale` counts as alive:
 * a stale finding seen again comes back under its own id (D-457 point 7).
 */
function sameSubject(byId, newTitle, date) {
  const matches = [];
  for (const [id, history] of byId) {
    const last = history.at(-1).obj;
    const status = statusOn(last, date);
    if (CLOSED.includes(status) && status !== 'stale') continue;
    const titles = history.map((l) => l.obj.title).filter((t) => typeof t === 'string');
    const best = Math.max(0, ...titles.map((t) => similarity(t, newTitle)));
    if (best >= SAME_SUBJECT)
      matches.push({ id, status, similarity: best, agent: last.agent, title: last.title });
  }
  return matches.sort((a, b) => b.similarity - a.similarity);
}

// ---------- seen ----------

const SEEN_OPTIONS = [
  'status',
  'evidence',
  'evidence-file',
  'title',
  'title-file',
  'severity',
  'visible',
  'cause',
  'cause-file',
  'proposal',
  'proposal-file',
  'owner',
  'confidence',
  'of',
  'until',
  'verify',
  'report',
  'quoted',
  'quoted-file',
  'task',
  'public',
  'by',
];

function seen(argv) {
  const { positional, options } = parseArgs(argv, SEEN_OPTIONS);
  if (positional.length !== 1)
    refuse('seen takes one id: finding.mjs seen <id> --status <status> --evidence-file <file>');
  const id = positional[0];
  const status = readStatus(oneOf(options, 'status', [...STATUSES, 'fixed'], false) ?? 'open');
  const evidence =
    text(options, 'evidence') ??
    refuse(
      'missing --evidence or --evidence-file: a line says what was seen today, or why the status changed',
    );
  const date = today();
  const dir = findingsDir();
  return withLock(dir, () => {
    const byId = histories(readFolder(dir));
    const history = byId.get(id);
    if (!history)
      refuse(
        `no finding has the id ${id}: \`seen\` continues a finding that exists; a new one is filed with \`add\``,
      );
    const first = history[0].obj;
    const last = history.at(-1).obj;
    const line = {
      id,
      agent: first.agent,
      severity: severity(options, false) ?? last.severity,
      visible_to_users: truth(options, 'visible', false) ?? last.visible_to_users,
      title: title(options, false) ?? last.title,
      evidence,
      likely_cause: text(options, 'cause') ?? last.likely_cause,
      proposal: text(options, 'proposal') ?? last.proposal,
      owner: oneOf(options, 'owner', OWNERS, false) ?? last.owner,
      confidence: oneOf(options, 'confidence', CONFIDENCES, false) ?? last.confidence,
      status,
      first_seen: first.first_seen ?? last.first_seen ?? /\d{4}-\d{2}-\d{2}/.exec(id)?.[0],
    };
    for (const key of CARRIED) if (key in last) line[key] = last[key];
    optionalFields(options, line);
    const isPublic = truth(options, 'public', false);
    if (isPublic !== undefined) line.public = isPublic;

    const previous = statusOn(last, date);
    if (status === 'new')
      refuse('`new` is how a finding is born, with `add`; a finding seen again is `open`');
    if (CLOSED.includes(previous) && status !== 'open') {
      refuse(
        `${id} is closed (${previous}): the only status that can follow is \`open\`, when it has come back`,
      );
    }
    if (status === 'stale') {
      // judged on the severity on record: one call cannot lower it and close it
      if (![last.severity, line.severity].every((s) => s === 'minor' || s === 'info')) {
        refuse('a critical or major finding is never closed as stale (D-457 point 7)');
      }
      const lastLine = history.at(-1).file.slice(0, 10);
      const quiet = validDate(lastLine) ? daysBetween(lastLine, date) : null;
      if (quiet === null || quiet < STALE_AFTER_DAYS) {
        refuse(
          `${id} is not stale: its last line is ${quiet === null ? 'of an unknown day' : `${quiet} day(s) old`}, and stale is for a minor finding with no line for ${STALE_AFTER_DAYS} days (D-457 point 7)`,
        );
      }
    }
    const by = options.by;
    if (by !== undefined) {
      if (!BY_RE.test(by)) refuse('--by is one short name, the person who decided');
      line.by = by;
    }
    const person = (what) => {
      if (by === undefined) refuse(`${what} is a person's decision: say whose with --by <name>`);
      if (AGENTS.includes(by)) {
        refuse(
          `${what} is a person's decision, and ${by} is an agent: an agent proposes it in its report`,
        );
      }
    };
    if (PERSON_STATUSES.includes(status)) person(`\`${status}\``);
    if (isPublic !== undefined) {
      if (line.agent !== 'security') {
        refuse(
          '--public is for a security finding only: nothing else is withheld from the console',
        );
      }
      person('showing a security finding on the console (--public)');
    }
    if (status === 'duplicate') {
      const of = options.of ?? refuse('a duplicate names the finding it repeats: --of <id>');
      if (of === id) refuse('a finding is not a duplicate of itself');
      if (!byId.has(of)) refuse(`--of ${of}: no finding has that id`);
      line.duplicate_of = of;
    } else if (options.of !== undefined) {
      refuse('--of goes with --status duplicate');
    }
    if (status === 'snoozed') {
      const until =
        options.until ?? refuse('a snoozed finding names the day it wakes: --until YYYY-MM-DD');
      if (!validDate(until) || until <= date)
        refuse(`--until must be a date after today (${date})`);
      line.until = until;
    } else if (options.until !== undefined) {
      refuse('--until goes with --status snoozed');
    }
    refuseIfInvalid(line);
    append(dir, date, line);
    return `${id} ${status}`;
  });
}

// ---------- validate ----------

function validate(argv, everyFile) {
  const { positional, options } = parseArgs(argv, ['json', 'agent']);
  if (options.agent !== undefined) oneOf(options, 'agent', AGENTS, true);
  let dir = findingsDir();
  let wanted = null;
  if (!everyFile && positional.length > 0) {
    const paths = positional.map((p) => {
      const path = nativePath(p);
      // a bare date or file name means that day's file in the findings folder
      const named = /[\\/]/.test(path)
        ? path
        : join(dir, path.endsWith('.jsonl') ? path : `${path}.jsonl`);
      if (!existsSync(named)) refuse(`no such file: ${named}`);
      return resolve(named);
    });
    dir = dirname(paths[0]);
    if (paths.some((p) => dirname(p) !== dir))
      refuse('validate takes files of one folder at a time');
    wanted = new Set(paths.map((p) => basename(p)));
  } else if (everyFile && positional.length > 0) {
    refuse('check takes no file: it reads every findings file');
  }
  if (!existsSync(dir)) refuse(`no such folder: ${dir}`);

  const lines = readFolder(dir);
  const earlierById = new Map();
  const problems = [];
  const counted = new Set();
  let lineCount = 0;
  for (const line of lines) {
    const inScope = wanted === null || wanted.has(line.file);
    const report = (problem) => {
      const mine =
        options.agent === undefined ||
        (line.obj ? line.obj.agent === options.agent : line.raw.includes(`"${options.agent}"`));
      if (inScope && mine)
        problems.push({
          file: line.file,
          line: line.n,
          id: typeof line.obj?.id === 'string' ? line.obj.id : null,
          ...problem,
        });
    };
    if (inScope) {
      counted.add(line.file);
      lineCount += 1;
    }
    if (line.blank) {
      report({ level: 'warning', code: 'blank-line', message: 'a blank line' });
      continue;
    }
    if (line.error !== undefined) {
      report({
        level: 'error',
        code: 'not-json',
        message: `does not parse as JSON (${line.error})`,
      });
      continue;
    }
    const knownLegacy = LEGACY_NO_FIRST_SEEN.get(`${line.file}:${line.n}`) === line.obj?.id;
    for (const problem of lineProblems(line.obj)) {
      if (knownLegacy && problem.message === 'missing `first_seen`') {
        report({
          level: 'warning',
          code: 'legacy-no-first-seen',
          message: 'no `first_seen`: a known line from before finding.mjs, kept as it is (T-1884)',
        });
      } else {
        report(problem);
      }
    }
    const id = line.obj && typeof line.obj === 'object' ? line.obj.id : undefined;
    if (typeof id !== 'string') continue;
    const earlier = earlierById.get(id) ?? [];
    historyProblems(line, earlier).forEach(report);
    earlierById.set(id, [...earlier, line]);
  }

  const errors = problems.filter((p) => p.level === 'error');
  const warnings = problems.filter((p) => p.level === 'warning');
  if (options.json) {
    process.stdout.write(
      `${JSON.stringify({ folder: dir, files: counted.size, lines: lineCount, errors, warnings }, null, 2)}\n`,
    );
  } else {
    for (const p of problems)
      process.stdout.write(`${p.file}:${p.line}: ${p.level} [${p.code}] ${p.message}\n`);
    process.stdout.write(
      `${counted.size} file(s), ${lineCount} line(s): ${errors.length} error(s), ${warnings.length} warning(s)\n`,
    );
  }
  return errors.length === 0 ? 0 : EXIT_REFUSED;
}

// ---------- list ----------

const STATUS_GROUPS = {
  open: OPEN,
  waiting: WAITING,
  closed: CLOSED,
  alive: [...OPEN, ...WAITING],
};

function list(argv) {
  const { positional, options } = parseArgs(argv, [
    'agent',
    'status',
    'severity',
    'owner',
    'older-than',
    'quiet',
    'search',
    'like',
  ]);
  if (positional.length > 0) refuse(`list takes options only, not "${positional[0]}"`);
  const agent =
    options.agent === undefined
      ? undefined
      : (Object.keys(PREFIX).find((a) => PREFIX[a] === options.agent) ??
        oneOf(options, 'agent', AGENTS, true));
  const statuses =
    options.status === undefined
      ? null
      : (STATUS_GROUPS[options.status] ?? [
          readStatus(
            oneOf(options, 'status', [...STATUSES, 'fixed', ...Object.keys(STATUS_GROUPS)], true),
          ),
        ]);
  const wantedSeverity = oneOf(options, 'severity', SEVERITIES, false);
  const owner = oneOf(options, 'owner', OWNERS, false);
  const days = (name) => {
    if (options[name] === undefined) return undefined;
    if (!/^\d+$/.test(options[name])) refuse(`--${name} is a number of days`);
    return Number(options[name]);
  };
  const olderThan = days('older-than');
  const quiet = days('quiet');
  const needles = (options.search ?? '').toLowerCase().split(/\s+/).filter(Boolean);
  const like = options.like === undefined ? undefined : unmangle('like', options.like);
  const date = today();

  const out = [];
  for (const [id, history] of histories(readFolder(findingsDir()))) {
    const last = history.at(-1);
    const o = last.obj;
    const firstSeen = validDate(history[0].obj.first_seen)
      ? history[0].obj.first_seen
      : history[0].file.slice(0, 10);
    const lastLine = last.file.slice(0, 10);
    const row = {
      ...o,
      id,
      status: statusOn(o, date),
      first_seen: firstSeen,
      last_line: lastLine,
      lines: history.length,
      age_days: validDate(firstSeen) ? daysBetween(firstSeen, date) : null,
      quiet_days: validDate(lastLine) ? daysBetween(lastLine, date) : null,
    };
    if (agent !== undefined && o.agent !== agent) continue;
    if (statuses !== null && !statuses.includes(row.status)) continue;
    if (wantedSeverity !== undefined && o.severity !== wantedSeverity) continue;
    if (owner !== undefined && o.owner !== owner) continue;
    if (olderThan !== undefined && !(row.age_days !== null && row.age_days >= olderThan)) continue;
    if (quiet !== undefined && !(row.quiet_days !== null && row.quiet_days >= quiet)) continue;
    if (needles.length > 0) {
      const hay = [id, o.title, o.evidence, o.likely_cause, o.proposal].join('\n').toLowerCase();
      if (!needles.every((needle) => hay.includes(needle))) continue;
    }
    if (like !== undefined) {
      const titles = history.map((l) => l.obj.title).filter((t) => typeof t === 'string');
      row.similarity = Math.max(0, ...titles.map((t) => similarity(t, like)));
      if (row.similarity < SAME_SUBJECT) continue;
    }
    out.push(row);
  }
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  return 0;
}

// ---------- main ----------

const HELP = `finding.mjs: the one door for the agent team's findings (T-1884, D-457).
Folder: $OPS_ROOT/findings (default E:/FMIP/ops/findings), one file a UTC day.

  add       file a new finding; prints the id it was given
            --agent <agent> --severity critical|major|minor --visible true|false
            --title "..." --evidence-file <file> --cause "..." --proposal "..."
            --owner maintainer|engineering-session|<agent> --confidence high|medium|low
            [--status new|decide] [--verify "..."] [--report <path>] [--quoted-file <file>] [--task T-n]
            [--new]   file it although an open finding has a similar title
  seen      <id> a finding seen again, or its status changed; one new line, same id
            [--status ${STATUSES.filter((s) => s !== 'new').join('|')}]   (default open; fixed = fixed-unverified)
            --evidence-file <file>   what was seen today, or why the status changed
            [--of <id>] with duplicate   [--until YYYY-MM-DD] with snoozed
            [--by <person>] needed for ${PERSON_STATUSES.join(', ')} and --public: a person's decisions, never an agent's
            stale: only a minor finding whose last line is ${STALE_AFTER_DAYS} days old or more
            [--title --severity --visible --cause --proposal --owner --confidence --verify --report
             --quoted-file --task]   anything not given is carried from the last line
            [--public true|false]    a security finding only
  validate  [<file or date>...] [--agent <agent>] [--json]   names each bad line; exit 1 on an error
  check     [--json]            validate on every file of the folder
  list      [--agent <agent or prefix>] [--status <status>|open|waiting|closed|alive] [--severity <s>]
            [--owner <o>] [--older-than <days>] [--quiet <days>] [--search "words"] [--like "a title"]
            the latest state of each finding, as JSON

Text with quotes, backslashes, or a slash-led path goes in a file: --title-file, --evidence-file,
--cause-file, --proposal-file, --quoted-file (Git Bash rewrites such an argument; what cannot be
put back for certain is refused). Exit codes: 0 done, 1 refused (the reason is printed),
3 not added because an open finding looks like the same subject.
`;

function main(argv) {
  const [command, ...rest] = argv;
  switch (command) {
    case 'add':
      process.stdout.write(`${add(rest)}\n`);
      return 0;
    case 'seen':
      process.stdout.write(`${seen(rest)}\n`);
      return 0;
    case 'validate':
      return validate(rest, false);
    case 'check':
      return validate(rest, true);
    case 'list':
      return list(rest);
    case undefined:
    case 'help':
    case '--help':
      process.stdout.write(HELP);
      return 0;
    default:
      return refuse(`unknown command "${command}" (add, seen, validate, check, list, help)`);
  }
}

try {
  process.exitCode = main(process.argv.slice(2));
} catch (error) {
  if (!(error instanceof Refusal)) throw error;
  process.stderr.write(`finding.mjs: ${error.message}\n`);
  process.exitCode = error.code;
}
