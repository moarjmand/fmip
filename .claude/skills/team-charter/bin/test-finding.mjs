// Runs finding.mjs on its cases (T-1884): `node .claude/skills/team-charter/bin/test-finding.mjs`.
// Run it after any change to finding.mjs or to the charter's finding format; it exits 1 on a wrong
// result. Every case works in a temp folder through OPS_ROOT: the real findings are never touched.
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const script = join(here, 'finding.mjs');
const TODAY = '2026-11-20';

let right = 0;
let wrong = 0;
function check(name, ok, detail = '') {
  if (ok) right += 1;
  else {
    wrong += 1;
    console.log(
      `WRONG  ${name}${detail ? `\n       ${String(detail).replace(/\n/g, '\n       ')}` : ''}`,
    );
  }
}

/** A fresh ops folder; `seed` maps a findings file name to its lines (objects or raw text). */
function ops(seed = {}) {
  const root = mkdtempSync(join(tmpdir(), 'finding-test-'));
  mkdirSync(join(root, 'findings'));
  for (const [name, lines] of Object.entries(seed)) {
    writeFileSync(
      join(root, 'findings', name),
      `${lines.map((l) => (typeof l === 'string' ? l : JSON.stringify(l))).join('\n')}\n`,
    );
  }
  return root;
}
const envOf = (root, date = TODAY, more = {}) => ({
  ...process.env,
  OPS_ROOT: root,
  FINDING_TODAY: date,
  EXEPATH: '',
  ...more,
});
function run(root, args, date, more) {
  const r = spawnSync('node', [script, ...args], {
    encoding: 'utf8',
    env: envOf(root, date, more),
  });
  return { code: r.status, out: r.stdout, err: r.stderr };
}
function runAsync(root, args) {
  return new Promise((done) => {
    const child = spawn('node', [script, ...args], { env: envOf(root) });
    let out = '';
    let err = '';
    child.stdout.on('data', (c) => (out += c));
    child.stderr.on('data', (c) => (err += c));
    child.on('close', (code) => done({ code, out, err }));
  });
}
const fileOf = (root, date = TODAY) => join(root, 'findings', `${date}.jsonl`);
const rawLines = (root, date = TODAY) =>
  existsSync(fileOf(root, date))
    ? readFileSync(fileOf(root, date), 'utf8').split('\n').slice(0, -1)
    : [];
const parsed = (root, date) => rawLines(root, date).map((l) => JSON.parse(l));

/** The nine things an agent says; the id, the status and the date are the script's. */
const base = {
  agent: 'qa-engineer',
  severity: 'minor',
  visible: 'true',
  title: 'fa competition page overflows at 375 px',
  evidence: 'innerWidth 415, scrollWidth 415',
  cause: 'unknown',
  proposal: 'wrap the standings table',
  owner: 'engineering-session',
  confidence: 'high',
};
const args = (change = {}, drop = []) =>
  Object.entries({ ...base, ...change })
    .filter(([key]) => !drop.includes(key))
    .flatMap(([key, value]) => [`--${key}`, value]);
const stored = (over = {}) => ({
  id: 'qa-2026-11-10-01',
  agent: 'qa-engineer',
  severity: 'minor',
  visible_to_users: true,
  title: 'fa competition page overflows at 375 px',
  evidence: 'innerWidth 415',
  likely_cause: 'unknown',
  proposal: 'wrap the standings table',
  owner: 'engineering-session',
  confidence: 'high',
  status: 'new',
  first_seen: '2026-11-10',
  ...over,
});

// The three lines of the real files that did not parse (2026-11-02 line 26, 2026-11-05 line 5,
// 2026-11-18 line 9): a backslash typed into hand-written JSON. They are this script's first data.
const BROKEN = [
  String.raw`{"id": "arc-2026-11-02-01", "agent": "architect", "severity": "minor", "visible_to_users": false, "title": "boundary-check.sh fan-out counts spec files and misses ../../ imports", "evidence": "script: watchdog 8, ingestion 9; grep -h drops filenames so the script's spec filter never applies", "likely_cause": "first version of the script", "proposal": "use grep -rnoE with filenames, drop .spec.ts/.test.ts, match (\.\./)+<module>/ and keep only targets that are module folders (TD-03 b)", "owner": "engineering-session", "confidence": "high", "status": "new", "first_seen": "2026-11-02"}`,
  String.raw`{"id": "soc-2026-11-05-01", "agent": "social-media", "severity": "minor", "visible_to_users": false, "title": "social-drafts.sql fails in two sections with 'unterminated quoted string'", "evidence": "run.sh social-drafts.sql printed '== the' / 'unterminated quoted string' twice", "likely_cause": "an apostrophe in a section heading echo ('the newest forecast...' / 'founder's') breaks the quoting", "proposal": "escape or drop the apostrophes in the \echo lines of .claude/skills/social-drafts/social-drafts.sql", "owner": "engineering-session", "confidence": "medium", "status": "new", "first_seen": "2026-11-05"}`,
  String.raw`{"id": "soc-2026-11-18-01", "agent": "social-media", "severity": "minor", "visible_to_users": false, "title": "social-drafts.sql has apostrophes inside \echo lines; the runner prints 'unterminated quoted string'", "evidence": "run.sh social-drafts.sql on 2026-11-18: '== the' and '== the...' headers cut off", "likely_cause": "psql \echo with an unescaped ' (channel's, founder's)", "proposal": "remove apostrophes from the \echo text in .claude/skills/social-drafts/social-drafts.sql", "owner": "engineering-session", "confidence": "high", "status": "new", "first_seen": "2026-11-18"}`,
];

// ---------- 1. the text that broke three lines is written as one valid line ----------
{
  const root = ops();
  check('the three fixture lines are indeed not JSON', BROKEN.every((l) => { try { JSON.parse(l); return false; } catch { return true; } })); // prettier-ignore
  BROKEN.forEach((text, i) => {
    const file = join(root, `evidence-${i}.txt`);
    writeFileSync(file, text);
    const viaFile = run(root, [
      'add',
      ...args(
        { agent: 'social-media', title: `broken line ${i} through a file`, 'evidence-file': file },
        ['evidence'],
      ),
      '--new',
    ]);
    const viaArg = run(root, [
      'add',
      ...args({ agent: 'social-media', title: `broken line ${i} as an argument`, evidence: text }),
      '--new',
    ]);
    check(
      `broken line ${i}: both ways are accepted`,
      viaFile.code === 0 && viaArg.code === 0,
      viaFile.err + viaArg.err,
    );
  });
  const raw = rawLines(root);
  let lines = [];
  try {
    lines = raw.map((l) => JSON.parse(l));
  } catch (error) {
    check('every written line parses', false, error.message);
  }
  check(
    'six calls wrote six lines, one each',
    raw.length === 6 && lines.length === 6,
    `${raw.length} lines`,
  );
  check(
    'the evidence is the text, character for character',
    lines.length === 6 &&
      BROKEN.every(
        (text, i) => lines[2 * i].evidence === text && lines[2 * i + 1].evidence === text,
      ),
  );
  check('validate passes on what was written', run(root, ['validate', TODAY]).code === 0);
  rmSync(root, { recursive: true, force: true });
}

// ---------- 2. twenty add calls at once: twenty ids, twenty valid lines ----------
{
  const root = ops();
  const results = await Promise.all(
    Array.from({ length: 20 }, (_, i) =>
      runAsync(root, ['add', ...args({ title: `parallel run, finding ${i}` }), '--new']),
    ),
  );
  const ids = results.map((r) => r.out.trim());
  check('twenty calls all succeed', results.every((r) => r.code === 0), results.map((r) => r.err).join('')); // prettier-ignore
  check('twenty different ids', new Set(ids).size === 20, ids.join(' '));
  check(
    'the ids are 01 to 20 of the day',
    [...ids].sort().join() ===
      Array.from({ length: 20 }, (_, i) => `qa-${TODAY}-${String(i + 1).padStart(2, '0')}`).join(),
    ids.join(' '),
  );
  let lines = [];
  try {
    lines = parsed(root);
  } catch (error) {
    check('twenty valid lines', false, error.message);
  }
  check(
    'twenty valid lines, one per id',
    lines.length === 20 && new Set(lines.map((l) => l.id)).size === 20,
    `${lines.length} lines`,
  );
  check('validate passes on them', run(root, ['validate', TODAY]).code === 0);
  check('the lock is released', !existsSync(join(root, 'findings', '.lock')));
  rmSync(root, { recursive: true, force: true });
}

// ---------- 3. each refusal, with its reason, and nothing written ----------
{
  const root = ops({ '2026-11-10.jsonl': [stored()] });
  const keyShaped = `gh${'p'}_${'a1B2'.repeat(9)}`; // built here so that this file holds no secret-shaped text
  const refusals = [
    ['a missing field', args({}, ['proposal']), /missing --proposal/],
    ['a missing agent', args({}, ['agent']), /missing --agent/],
    ['an unknown agent', args({ agent: 'qa' }), /unknown agent "qa"/],
    ['the chief of staff', args({ agent: 'chief-of-staff' }), /files no findings/],
    ['an unknown severity', args({ severity: 'blocker' }), /unknown severity "blocker"/],
    ['info', args({ severity: 'info' }), /`info` is not filed as a finding/],
    ['an unknown status', args({ status: 'done' }), /unknown status "done"/],
    [
      'a status a finding is not born with',
      args({ status: 'resolved' }),
      /unknown status "resolved"/,
    ],
    ['an unknown owner', args({ owner: 'the-team' }), /unknown owner "the-team"/],
    ['an unknown confidence', args({ confidence: 'certain' }), /unknown confidence "certain"/],
    ['visible that is not true or false', args({ visible: 'maybe' }), /--visible is true or false/],
    ['a hand-made id', [...args(), '--id', 'qa-2026-11-20-07'], /an id is never chosen by hand/],
    [
      'a hand-made id as a word',
      ['qa-2026-11-20-07', ...args()],
      /the id is allocated by the script/,
    ],
    [
      'a key-shaped string in the evidence',
      args({ evidence: `the header carried ${keyShaped}` }),
      /looks like a GitHub token/,
    ],
    [
      'a password with its value',
      args({ proposal: 'set DB_PASSWORD=hunter2hunter2 in the file' }),
      /password, token or key with its value/,
    ],
    [
      'a URL holding a password',
      args({ evidence: 'postgres://fmip:s3cretpass@db:5432/fmip refused the connection' }),
      /URL with a password/,
    ],
    [
      'an option it does not know',
      [...args(), '--evidence_file', 'x'],
      /unknown option --evidence_file/,
    ],
    ['a title of two lines', args({ title: 'one\ntwo' }), /--title is one line/],
    ['public on a new finding', [...args(), '--public', 'true'], /unknown option --public/],
  ];
  for (const [name, argv, reason] of refusals) {
    const r = run(root, ['add', ...argv]);
    check(`refused: ${name}`, r.code === 1 && reason.test(r.err), `exit ${r.code}: ${r.err}`);
    check(
      `refused: ${name} never prints the secret`,
      !r.err.includes(keyShaped) && !r.err.includes('hunter2') && !r.err.includes('s3cretpass'),
    );
  }
  check(
    'no refusal wrote anything',
    rawLines(root).length === 0 &&
      readdirSync(join(root, 'findings')).join() === '2026-11-10.jsonl',
  );
  check(
    'text that only names a token passes',
    run(root, [
      'add',
      ...args({
        title: 'the reset token is not rate limited',
        evidence:
          'POST /auth/reset with a wrong token: 200 every time, commit 2ac3324b71cb8994d06c2f35be706d40c6103098',
      }),
    ]).code === 0,
  );
  rmSync(root, { recursive: true, force: true });
}

// ---------- 4. seen: the same id, one more line; an unknown id is refused ----------
{
  const root = ops({
    '2026-11-10.jsonl': [
      stored(),
      stored({
        id: 'ops-2026-11-10-01',
        agent: 'ops-release',
        severity: 'major',
        title: 'disk 81% full',
        verify: 'invariant:disk',
        task: 'T-1900',
      }),
    ],
  });
  const again = run(root, ['seen', 'qa-2026-11-10-01', '--evidence', 'still 415 px on 2026-11-20']);
  const [line] = parsed(root);
  check(
    'seen appends one line with the same id',
    again.code === 0 && rawLines(root).length === 1 && line.id === 'qa-2026-11-10-01',
    again.err,
  );
  check(
    'seen defaults to open and keeps what it was not told',
    line.status === 'open' &&
      line.title === stored().title &&
      line.first_seen === '2026-11-10' &&
      line.evidence === 'still 415 px on 2026-11-20',
  );
  check('the earlier file is untouched', rawLines(root, '2026-11-10').length === 2);
  const unknown = run(root, ['seen', 'qa-2026-11-10-09', '--evidence', 'x']);
  check(
    'seen is refused for an id the files do not hold',
    unknown.code === 1 &&
      /no finding has the id qa-2026-11-10-09/.test(unknown.err) &&
      rawLines(root).length === 1,
    unknown.err,
  );
  check('seen needs evidence', run(root, ['seen', 'qa-2026-11-10-01']).code === 1);
  check(
    'seen cannot make a finding new again',
    /`new` is how a finding is born/.test(
      run(root, ['seen', 'qa-2026-11-10-01', '--status', 'new', '--evidence', 'x']).err,
    ),
  );

  const fixed = run(root, [
    'seen',
    'qa-2026-11-10-01',
    '--status',
    'fixed',
    '--evidence',
    'PR #940 merged',
  ]);
  check(
    '`fixed` is taken as `fixed-unverified`',
    fixed.code === 0 && parsed(root).at(-1).status === 'fixed-unverified',
    fixed.err,
  );
  check(
    'resolved closes it',
    run(root, [
      'seen',
      'qa-2026-11-10-01',
      '--status',
      'resolved',
      '--evidence',
      're-checked at 375 px: no overflow',
    ]).code === 0,
  );
  const afterClosed = run(root, [
    'seen',
    'qa-2026-11-10-01',
    '--status',
    'planned',
    '--evidence',
    'x',
  ]);
  check(
    'a closed finding only reopens',
    afterClosed.code === 1 && /is closed \(resolved\)/.test(afterClosed.err),
    afterClosed.err,
  );
  check(
    'a closed finding that came back is open',
    run(root, ['seen', 'qa-2026-11-10-01', '--status', 'open', '--evidence', 'back at 415 px'])
      .code === 0,
  );

  check(
    'a major finding is never stale',
    /never closed as stale/.test(
      run(root, [
        'seen',
        'ops-2026-11-10-01',
        '--status',
        'stale',
        '--evidence',
        'no line for 14 days',
      ]).err,
    ),
  );
  check(
    'a duplicate names what it repeats',
    /--of <id>/.test(
      run(root, ['seen', 'ops-2026-11-10-01', '--status', 'duplicate', '--evidence', 'same as qa'])
        .err,
    ),
  );
  check(
    'a duplicate of an unknown id is refused',
    /no finding has that id/.test(
      run(root, [
        'seen',
        'ops-2026-11-10-01',
        '--status',
        'duplicate',
        '--of',
        'qa-2026-11-01-77',
        '--evidence',
        'x',
      ]).err,
    ),
  );
  check(
    'a snooze needs a day after today',
    /--until must be a date after today/.test(
      run(root, [
        'seen',
        'ops-2026-11-10-01',
        '--status',
        'snoozed',
        '--until',
        TODAY,
        '--evidence',
        'x',
      ]).err,
    ),
  );
  const snooze = run(root, [
    'seen',
    'ops-2026-11-10-01',
    '--status',
    'snoozed',
    '--until',
    '2026-11-25',
    '--evidence',
    'after the cup week',
  ]);
  const snoozed = parsed(root).at(-1);
  check(
    'a snooze carries its date and the optional fields of the last line',
    snooze.code === 0 &&
      snoozed.until === '2026-11-25' &&
      snoozed.verify === 'invariant:disk' &&
      snoozed.task === 'T-1900',
    snooze.err,
  );
  const listOn = (date) => JSON.parse(run(root, ['list', '--agent', 'ops'], date).out)[0].status;
  check(
    'a snoozed finding reads as open again on its date',
    listOn('2026-11-24') === 'snoozed' && listOn('2026-11-25') === 'open',
  );
  const dup = run(root, [
    'seen',
    'ops-2026-11-10-01',
    '--status',
    'duplicate',
    '--of',
    'qa-2026-11-10-01',
    '--evidence',
    'the same overflow',
  ]);
  check(
    'a duplicate is written with the id it repeats',
    dup.code === 0 &&
      parsed(root).at(-1).duplicate_of === 'qa-2026-11-10-01' &&
      !('until' in parsed(root).at(-1)),
    dup.err,
  );
  check(
    'validate passes on every line seen wrote',
    run(root, ['check']).code === 0,
    run(root, ['check']).out,
  );
  rmSync(root, { recursive: true, force: true });
}

// ---------- 5. the same subject is found before a new finding is filed ----------
{
  const root = ops({
    '2026-11-10.jsonl': [
      stored(),
      stored({
        id: 'cnt-2026-11-10-01',
        agent: 'content-community',
        title: 'Yahoo Sports share of the news is 61%',
      }),
      stored({
        id: 'cnt-2026-11-10-01',
        agent: 'content-community',
        title: 'Yahoo Sports share of the news is 61%',
        status: 'resolved',
      }),
      stored({
        id: 'seo-2026-11-10-01',
        agent: 'seo-search',
        title: 'no share image on the home page',
        status: 'stale',
      }),
    ],
  });
  const same = run(root, [
    'add',
    ...args({ agent: 'designer', title: 'the fa competition page overflows at 375 px again' }),
  ]);
  check(
    'a title that matches an open finding is not added',
    same.code === 3 && rawLines(root).length === 0,
    `exit ${same.code}`,
  );
  check(
    'the match is printed, with what to do',
    /qa-2026-11-10-01\s+new\s+0\.\d\d\s+qa-engineer/.test(same.err) &&
      /seen <id>/.test(same.err) &&
      /--new/.test(same.err),
    same.err,
  );
  const forced = run(root, [
    'add',
    ...args({ agent: 'designer', title: 'the fa competition page overflows at 375 px again' }),
    '--new',
  ]);
  check(
    '--new files it under a new id',
    forced.code === 0 && forced.out.trim() === `des-${TODAY}-01`,
    forced.err,
  );
  check(
    'a resolved finding is not a match',
    run(root, [
      'add',
      ...args({ agent: 'content-community', title: 'Yahoo Sports share of the news is 64%' }),
    ]).code === 0,
  );
  check(
    'a stale finding is: it comes back under its own id',
    run(root, ['add', ...args({ agent: 'seo-search', title: 'no share image on the home page' })])
      .code === 3,
  );
  check(
    'another subject is added',
    run(root, ['add', ...args({ title: 'match page shows a stale score' })]).code === 0,
  );
  rmSync(root, { recursive: true, force: true });
}

// ---------- 6. validate names each bad line by number ----------
{
  const root = ops({
    '2026-11-17.jsonl': [
      stored({ id: 'qa-2026-11-17-01', first_seen: '2026-11-17' }), // 1: good
      BROKEN[1], // 2: not JSON
      stored({ id: 'qa-2026-11-17-02', status: 'done' }), // 3: unknown status
      JSON.stringify(stored({ id: 'qa-2026-11-17-03' })).replace(',"first_seen":"2026-11-10"', ''), // 4: a field missing
      stored({ id: 'qa-2026-11-17-early-kickoff' }), // 5: id outside the scheme
      stored({ id: 'ops-2026-11-17-01' }), // 6: another agent's prefix
      stored({ id: 'qa-2026-11-17-04', status: 'fixed' }), // 7: warning only
      stored({ id: 'ops-2026-11-01-reboot', agent: 'ops-release' }), // 8: warning only, the listed legacy id
      stored({
        id: 'qa-2026-11-17-01',
        title: 'player page: wrong club badge',
        first_seen: '2026-11-17',
      }), // 9: id filed again, another subject
      stored({
        id: 'qa-2026-11-17-05',
        severity: 'urgent',
        owner: 'nobody',
        confidence: 'sure',
        visible_to_users: 'yes',
      }), // 10: four bad values
      '[1, 2]', // 11: JSON, not an object
    ],
    '2026-11-18.jsonl': [
      stored({ id: 'qa-2026-11-18-01', first_seen: '2026-11-18' }),
      stored({ id: 'qa-2026-11-18-01', first_seen: '2026-11-18', status: 'resolved' }),
    ],
  });
  const bad = run(root, ['validate', join(root, 'findings', '2026-11-17.jsonl')]);
  const errorLines = [...bad.out.matchAll(/^2026-11-17\.jsonl:(\d+): error/gm)].map((m) =>
    Number(m[1]),
  );
  const warningLines = [...bad.out.matchAll(/^2026-11-17\.jsonl:(\d+): warning/gm)].map((m) =>
    Number(m[1]),
  );
  check('validate exits non-zero on a bad file', bad.code === 1, `exit ${bad.code}`);
  check(
    'validate names each bad line by number',
    [...new Set(errorLines)].join() === '2,3,4,5,6,10,11',
    `${errorLines.join()}\n${bad.out}`,
  );
  check(
    'validate says what is wrong with each',
    [
      '[not-json]',
      '[unknown-status]',
      '[missing-field] missing `first_seen`',
      '[id-out-of-scheme]',
      '[id-agent-mismatch]',
      '[unknown-severity]',
      '[unknown-owner]',
      '[unknown-confidence]',
      '[not-an-object]',
    ].every((s) => bad.out.includes(s)),
    bad.out,
  );
  check(
    '`fixed`, the listed legacy id and a reused id are warnings',
    warningLines.join() === '7,8,9' &&
      bad.out.includes('[status-fixed]') &&
      bad.out.includes('[id-reused]'),
    warningLines.join(),
  );
  const json = JSON.parse(run(root, ['validate', '2026-11-17', '--json']).out);
  check(
    'validate --json carries the same lines',
    json.errors.length === errorLines.length &&
      json.warnings.length === 3 &&
      json.lines === 11 &&
      json.errors[0].line === 2,
  );
  check(
    'validate --agent keeps to that agent',
    JSON.parse(run(root, ['validate', '2026-11-17', '--json', '--agent', 'ops-release']).out).errors
      .length === 0,
  );
  const good = run(root, ['validate', '2026-11-18.jsonl']);
  check(
    'validate passes a good file',
    good.code === 0 && /1 file\(s\), 2 line\(s\): 0 error\(s\), 0 warning\(s\)/.test(good.out),
    good.out,
  );
  check(
    'check reads every file',
    run(root, ['check']).code === 1 && /2 file\(s\), 13 line\(s\)/.test(run(root, ['check']).out),
  );
  check(
    'validate writes nothing',
    rawLines(root, '2026-11-17').length === 11 && !existsSync(join(root, 'findings', '.lock')),
  );
  check('a missing file is refused', run(root, ['validate', '2026-01-01']).code === 1);
  rmSync(root, { recursive: true, force: true });
}

// ---------- 7. list ----------
{
  const root = ops({
    '2026-11-01.jsonl': [
      stored({
        id: 'qa-2026-11-01-01',
        first_seen: '2026-11-01',
        title: 'news page mixes languages',
      }),
      stored({
        id: 'sec-2026-11-01-01',
        agent: 'security',
        severity: 'major',
        first_seen: '2026-11-01',
        title: 'no rate limit on reset',
      }),
    ],
    '2026-11-18.jsonl': [
      stored({
        id: 'sec-2026-11-01-01',
        agent: 'security',
        severity: 'major',
        first_seen: '2026-11-01',
        title: 'no rate limit on reset',
        status: 'fixed',
      }),
      stored({ id: 'qa-2026-11-18-01', first_seen: '2026-11-18' }),
    ],
  });
  const list = (...argv) => JSON.parse(run(root, ['list', ...argv]).out);
  check(
    'list gives the latest state of each finding',
    list().length === 3 &&
      list().find((f) => f.id === 'sec-2026-11-01-01').status === 'fixed-unverified',
  );
  check(
    'list by agent, by prefix too',
    list('--agent', 'qa-engineer').length === 2 && list('--agent', 'sec').length === 1,
  );
  check(
    'list by status and by group',
    list('--status', 'open').length === 2 &&
      list('--status', 'waiting').length === 1 &&
      list('--status', 'fixed-unverified').length === 1,
  );
  check('list by age', list('--older-than', '14').map((f) => f.id).join() === 'qa-2026-11-01-01,sec-2026-11-01-01' && list('--quiet', '14').map((f) => f.id).join() === 'qa-2026-11-01-01'); // prettier-ignore
  check(
    'list counts lines and days',
    list('--agent', 'sec')[0].lines === 2 &&
      list('--agent', 'sec')[0].age_days === 19 &&
      list('--agent', 'sec')[0].quiet_days === 2,
  );
  check(
    'list by words and by likeness',
    list('--search', 'NEWS languages').length === 1 &&
      list('--like', 'the news page mixes two languages').length === 1,
  );
  check(
    'list refuses a status it does not know',
    run(root, ['list', '--status', 'done']).code === 1,
  );
  rmSync(root, { recursive: true, force: true });
}

// ---------- 8. the mechanics around the file ----------
{
  const root = ops();
  writeFileSync(fileOf(root), JSON.stringify(stored({ id: `qa-${TODAY}-04`, first_seen: TODAY }))); // hand-written: no last newline
  const lock = join(root, 'findings', '.lock');
  mkdirSync(lock);
  const old = new Date(Date.now() - 120_000);
  utimesSync(lock, old, old); // a lock left by a process that died
  const r = run(root, ['add', ...args({ title: 'another subject entirely' })]);
  check("a dead process's lock is taken, not waited on for ever", r.code === 0, r.err);
  check('the next id follows the highest the file holds', r.out.trim() === `qa-${TODAY}-05`, r.out);
  check(
    'a file without its last newline still gets one line per finding',
    rawLines(root).length === 2 && parsed(root).length === 2,
  );
  if (process.platform === 'win32') {
    // Git Bash rewrites a leading slash into its own root before Node sees the argument
    const gitBash = { EXEPATH: 'C:\\Program Files\\Git\\bin' };
    const mangled = run(
      root,
      ['add', ...args({ title: 'C:/Program Files/Git/en/news shows a cricket story' })],
      TODAY,
      gitBash,
    );
    check(
      'a title the shell rewrote is put back',
      mangled.code === 0 && parsed(root).at(-1).title === '/en/news shows a cricket story',
      mangled.err,
    );
    const list = run(
      root,
      ['add', ...args({ title: 'C:\\Program Files\\Git\\opt\\fmip\\x;Y:\\z is listed twice' })],
      TODAY,
      gitBash,
    );
    check(
      'one it cannot put back is refused, with the way round',
      list.code === 1 && /--title-file/.test(list.err),
      list.err,
    );
  }
  check(
    'help names the commands',
    ['add', 'seen', 'validate', 'check', 'list'].every((c) =>
      run(root, ['help']).out.includes(`  ${c}`),
    ),
  );
  check('an unknown command is refused', run(root, ['append']).code === 1);
  rmSync(root, { recursive: true, force: true });
}

// ---------- 9. the charter no longer shows a heredoc ----------
{
  const charter = readFileSync(join(here, '..', 'SKILL.md'), 'utf8');
  check(
    'the charter shows no heredoc',
    !/<<-?\s*['"]?\w+['"]?\s*$/m.test(charter) && !charter.includes('cat >>'),
  );
  check(
    'the charter names the script',
    charter.includes('team-charter/bin/finding.mjs add') && charter.includes('finding.mjs seen'),
  );
}

console.log(`${right} of ${right + wrong} right`);
process.exit(wrong === 0 ? 0 : 1);
