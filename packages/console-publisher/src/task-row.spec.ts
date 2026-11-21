import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { guardText, securityLedger, withholds } from './redact.ts';
import { type ConsoleState, type TriageRequest, emptyState } from './snapshot.ts';
import {
  SECTION,
  WITHHELD_TEXT,
  type TaskRowSteps,
  addRows,
  cell,
  checkout,
  currentBacklog,
  highestTaskId,
  makeTaskRows,
  run,
  taskRow,
} from './task-row.ts';
import { applyTriage, findingDoor, readFindingLines } from './triage.ts';

/**
 * T-1907: the `task-row` step. The pure part on strings; the whole step on a
 * temp checkout with a temp `origin` and a temp findings folder, the real
 * `git` and the real `finding.mjs`, and a stand-in for opening the pull
 * request (the only part that needs GitHub).
 */
const SCRIPT = resolve(import.meta.dirname, '../../../.claude/skills/team-charter/bin/finding.mjs');
const TODAY = '2026-11-21';
const ID = (n: number) => `00000000-0000-4000-8000-00000000000${n}`;

const BACKLOG = [
  '# Phase 15',
  '',
  '| ID | Task | Deps | Acceptance |',
  '|---|---|---|---|',
  '| `[ ]` T-1907 | Finding triage | T-1884 | `- [ ]` a spec |',
  '| `[ ]` T-1945 | The last planned one | T-1907, T-1944 | `- [ ]` a spec |',
  '',
  '## Needs the maintainer',
  '',
  'Nothing yet.',
  '',
].join('\n');

describe('a task row, on strings', () => {
  it('finds the highest id and the current backlog', () => {
    expect(highestTaskId([BACKLOG, 'T-12 and T-2001, not XT-9999 or T-x'])).toBe(2001);
    expect(highestTaskId([''])).toBe(0);
    expect(
      currentBacklog([
        '04-tasks-phase-9.md',
        '04-tasks-phase-15.md',
        '04-tasks-phase-1.md',
        '04-tasks-notes.md',
      ]),
    ).toBe('04-tasks-phase-15.md');
    expect(currentBacklog(['README.md'])).toBeNull();
  });

  it('keeps a text inside its cell', () => {
    expect(cell('a | b\nc `d` <script> \\')).toBe("a \\| b c 'd' &lt;script> \\\\");
    expect([...cell('x'.repeat(700))]).toHaveLength(600);
    expect(cell('x'.repeat(700)).endsWith('…')).toBe(true);
  });

  const record = {
    id: 'ops-2026-11-21-01',
    agent: 'ops-release',
    severity: 'major',
    title: 'The disk is nearly full',
    evidence: 'df says 91% | on /',
    proposal: 'Prune the build cache weekly',
    quoted: 'outside text that stays out',
  };

  it('writes the finding id, evidence and proposal, and never its quoted outside text', () => {
    const row = taskRow('T-1946', record.id, { record, withheld: false });
    expect(row).toBe(
      "| `[ ]` T-1946 | The disk is nearly full (finding `ops-2026-11-21-01`, ops-release, major; accepted on the agents console, D-456 point 2). Evidence: df says 91% \\| on /. Proposal: Prune the build cache weekly | — | `- [ ]` the finding's agent re-checks it and marks it `resolved` |",
    );
    expect(row.split('\n')).toHaveLength(1);
    expect(row).not.toContain('outside text');
    expect(
      taskRow('T-1', record.id, {
        record: { ...record, verify: 'df is under 80%' },
        withheld: false,
      }),
    ).toContain('`- [ ]` df is under 80% |');
  });

  it("writes a withheld security finding's id alone", () => {
    const row = taskRow('T-1946', 'sec-2026-11-21-01', {
      record: { ...record, agent: 'security' },
      withheld: true,
    });
    expect(row).toContain('finding `sec-2026-11-21-01`, security, major');
    for (const secret of ['disk', 'df says', 'Prune']) expect(row).not.toContain(secret);
    // Another finding's text that names a withheld one is left out whole.
    const naming = taskRow(
      'T-1947',
      record.id,
      {
        record: { ...record, evidence: 'the same hole as sec-2026-11-21-01: port 5432' },
        withheld: false,
      },
      (value) => (value.includes('sec-2026-11-21-01') ? 'changed' : value),
    );
    expect(naming).toContain(`Evidence: ${WITHHELD_TEXT}`);
    expect(naming).not.toContain('5432');
    expect(naming).toContain('Proposal: Prune');
  });

  it('adds the rows to its own section, made once at the end', () => {
    const once = addRows(BACKLOG, ['| `[ ]` T-1946 | a | — | b |']);
    expect(once.startsWith(BACKLOG)).toBe(true);
    expect(once.split(SECTION)).toHaveLength(2);
    expect(once.endsWith('|---|---|---|---|\n| `[ ]` T-1946 | a | — | b |\n')).toBe(true);
    const twice = addRows(once, ['| `[ ]` T-1947 | c | — | d |', '| `[ ]` T-1948 | e | — | f |']);
    expect(twice.split(SECTION)).toHaveLength(2);
    expect(
      twice.endsWith(
        '| `[ ]` T-1946 | a | — | b |\n| `[ ]` T-1947 | c | — | d |\n| `[ ]` T-1948 | e | — | f |\n',
      ),
    ).toBe(true);
    // A section followed by another heading keeps its rows inside itself.
    const followed = addRows(`${once}\n## After\n\ntext\n`, ['| `[ ]` T-1949 | g | — | h |']);
    expect(followed.indexOf('T-1949')).toBeLessThan(followed.indexOf('## After'));
    expect(addRows(BACKLOG, [])).toBe(BACKLOG);
  });
});

describe('the task-row step, on a temp checkout', () => {
  let home = '';
  let work = '';
  let origin = '';
  let ops = '';
  let opened: { branch: string; title: string; body: string }[] = [];
  const env = () => ({ ...process.env, OPS_ROOT: ops, FINDING_TODAY: TODAY });
  const git = (cwd: string, ...args: string[]): string => run('git', args, cwd).trim();

  const add = (agent: string, title: string, extra: string[] = []): string => {
    const result = spawnSync(
      process.execPath,
      [
        SCRIPT,
        'add',
        '--agent',
        agent,
        '--severity',
        'major',
        '--visible',
        'false',
        '--title',
        title,
        '--evidence',
        `evidence of: ${title}`,
        '--cause',
        'the cause',
        '--proposal',
        `proposal for: ${title}`,
        '--owner',
        'engineering-session',
        '--confidence',
        'high',
        ...extra,
      ],
      { env: env(), encoding: 'utf8' },
    );
    if (result.status !== 0) throw new Error(result.stderr);
    return result.stdout.trim();
  };
  const door = () => findingDoor(SCRIPT, ops, env());
  const last = (finding: string) => door().history(finding).at(-1)!;
  const accept = (state: ConsoleState, n: number, finding: string, by = 'mostafa') => {
    const request: TriageRequest = {
      id: ID(n),
      kind: 'finding.accept',
      finding,
      reason: '',
      until: '',
      by,
      at: '2026-11-21T10:00:00.000Z',
    };
    const applied = applyTriage({ ...state, triage: [request] }, door(), TODAY);
    expect(applied.reports[0]?.status).toBe('done');
    return applied.state;
  };
  const steps = (over: Partial<TaskRowSteps> = {}): TaskRowSteps => {
    const lines = readFindingLines(ops);
    const ledger = securityLedger(lines);
    const tree = checkout(work, {
      now: new Date(`${TODAY}T12:00:00Z`),
      open: (branch, title, body) => {
        opened.push({ branch, title, body });
        return `https://example.test/pull/${opened.length}`;
      },
    });
    return {
      history: door().history,
      seen: door().seen,
      withheld: (finding, agent) => withholds(ledger, finding, agent),
      guard: (value) => guardText(value, ledger).text,
      findingTasks: () =>
        lines.map((line) => (typeof line.record.task === 'string' ? line.record.task : '')),
      backlogs: tree.backlogs,
      pullRequest: tree.pullRequest,
      close: tree.close,
      ...over,
    };
  };
  const onBranch = (branch: string, file = 'docs/04-tasks-phase-15.md'): string =>
    git(origin, 'show', `${branch}:${file}`);

  beforeEach(() => {
    opened = [];
    home = mkdtempSync(join(tmpdir(), 'fmip-task-row-spec-'));
    origin = join(home, 'origin.git');
    work = join(home, 'work');
    ops = join(home, 'ops');
    mkdirSync(ops);
    git(home, 'init', '--quiet', '--bare', '-b', 'main', origin);
    git(home, 'clone', '--quiet', origin, work);
    git(work, 'config', 'user.name', 'Task Row Spec');
    git(work, 'config', 'user.email', 'task-row@example.test');
    git(work, 'config', 'commit.gpgsign', 'false');
    git(work, 'checkout', '--quiet', '-b', 'main');
    mkdirSync(join(work, 'docs'));
    writeFileSync(
      join(work, 'docs', '04-tasks-phase-14.md'),
      '| `[x]` T-1883 | Older | — | done |\n',
    );
    writeFileSync(join(work, 'docs', '04-tasks-phase-15.md'), BACKLOG);
    git(work, 'add', '.');
    git(work, 'commit', '--quiet', '-m', 'docs: backlog');
    git(work, 'push', '--quiet', '-u', 'origin', 'main');
  });
  afterEach(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('ends an accept as one row with a new id in a docs pull request, and the same id on the finding', () => {
    const disk = add('ops-release', 'The disk of the server is nearly full');
    const state = accept(emptyState(), 1, disk);
    // The maintainer's own checkout is on another branch with a change of its own.
    git(work, 'checkout', '--quiet', '-b', 't-1-something');
    writeFileSync(join(work, 'notes.txt'), 'mine\n');

    const result = makeTaskRows(state, steps(), TODAY);
    expect(result).toMatchObject({
      made: [{ finding: disk, task: 'T-1946' }],
      skipped: [],
      failures: [],
      pullRequest: 'https://example.test/pull/1',
    });
    expect(result.state.taskRows).toEqual([]);

    // One pull request, from a branch that changes the current backlog file alone.
    expect(opened).toHaveLength(1);
    const { branch, title, body } = opened[0]!;
    expect(branch).toBe('docs-task-rows-2026-11-21-t-1946');
    expect(title).toBe('docs: task row T-1946 for accepted findings');
    expect(body).toContain(`- T-1946: finding \`${disk}\``);
    expect(git(origin, 'diff', '--name-only', 'main', branch)).toBe('docs/04-tasks-phase-15.md');
    expect(git(origin, 'rev-list', '--count', `main..${branch}`)).toBe('1');
    const text = onBranch(branch);
    expect(text.startsWith(BACKLOG)).toBe(true);
    const rows = text.split('\n').filter((line) => line.includes('T-1946'));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain(`finding \`${disk}\``);
    expect(rows[0]).toContain('Evidence: evidence of: The disk of the server is nearly full');
    expect(rows[0]).toContain('Proposal: proposal for: The disk of the server is nearly full');
    // `main` is as it was: the row waits for the pull request.
    expect(onBranch('main')).toBe(BACKLOG.trim());

    // The same id is on the finding's last line, which is still planned.
    expect(last(disk)).toMatchObject({ status: 'planned', task: 'T-1946', by: 'mostafa' });
    expect(
      door()
        .history(disk)
        .map((line) => line.status),
    ).toEqual(['new', 'planned', 'planned']);

    // The working checkout was not touched.
    expect(git(work, 'branch', '--show-current')).toBe('t-1-something');
    expect(git(work, 'status', '--porcelain')).toBe('?? notes.txt');
    expect(readFileSync(join(work, 'docs', '04-tasks-phase-15.md'), 'utf8')).toBe(BACKLOG);
    expect(git(work, 'worktree', 'list').split('\n')).toHaveLength(1);
  });

  it('gives two accepts of one sync two ids in one pull request', () => {
    const disk = add('ops-release', 'The disk of the server is nearly full');
    const score = add('data-auditor', 'A final score differs from the official one');
    let state = accept(emptyState(), 1, disk);
    state = accept(state, 2, score, 'teammate');

    const result = makeTaskRows(state, steps(), TODAY);
    expect(result.made).toEqual([
      { finding: disk, task: 'T-1946' },
      { finding: score, task: 'T-1947' },
    ]);
    expect(opened).toHaveLength(1);
    expect(opened[0]?.title).toBe('docs: task rows T-1946, T-1947 for accepted findings');
    const text = onBranch(opened[0]!.branch);
    expect(text.match(/^\| `\[ \]` T-194[67] \|/gm)).toHaveLength(2);
    expect(git(origin, 'rev-list', '--count', `main..${opened[0]!.branch}`)).toBe('1');
    expect(last(disk)).toMatchObject({ task: 'T-1946', by: 'mostafa' });
    expect(last(score)).toMatchObject({ task: 'T-1947', by: 'teammate' });

    // A later accept, with that pull request still open: the ids on the findings are not given twice.
    const slow = add('qa-engineer', 'The match page is slow on a phone');
    const later = makeTaskRows(accept(result.state, 3, slow), steps(), TODAY);
    expect(later.made).toEqual([{ finding: slow, task: 'T-1948' }]);
    expect(opened).toHaveLength(2);
  });

  it('adds no row for a finding that already has a task, or that is no longer planned', () => {
    const tasked = add('ops-release', 'The disk of the server is nearly full', [
      '--task',
      'T-1907',
    ]);
    const gone = add('data-auditor', 'A final score differs from the official one');
    let state = accept(emptyState(), 1, tasked);
    // The accept itself asked for none...
    expect(state.taskRows).toEqual([]);
    state = accept(state, 2, gone);
    // ...and a request left for a finding that got its task, or was rejected since, makes none.
    state = {
      ...state,
      taskRows: [
        ...state.taskRows,
        { finding: tasked, by: 'mostafa', at: 'x', command: ID(3) },
        { finding: 'ops-2026-01-01-01', by: 'mostafa', at: 'x', command: ID(4) },
      ],
    };
    applyTriage(
      {
        ...emptyState(),
        triage: [
          {
            id: ID(5),
            kind: 'finding.snooze',
            finding: gone,
            reason: '',
            until: '2026-12-01',
            by: 'teammate',
            at: 'x',
          },
        ],
      },
      door(),
      TODAY,
    );
    const lines = readFindingLines(ops).length;

    const result = makeTaskRows(state, steps(), TODAY);
    expect(result.made).toEqual([]);
    expect(result.pullRequest).toBeNull();
    expect(result.skipped.map((s) => s.reason)).toEqual([
      'It is no longer planned (snoozed).',
      'It already has the task T-1907.',
      'No such finding on the computer.',
    ]);
    expect(result.state.taskRows).toEqual([]);
    expect(opened).toEqual([]);
    expect(git(origin, 'branch', '--list')).toBe('* main');
    expect(readFindingLines(ops)).toHaveLength(lines);
  });

  it('claims no id when the pull request cannot be opened', () => {
    const disk = add('ops-release', 'The disk of the server is nearly full');
    const state = accept(emptyState(), 1, disk);
    const before = readFindingLines(ops);
    expect(() =>
      makeTaskRows(
        state,
        steps({
          pullRequest: () => {
            throw new Error('gh pr failed: no network');
          },
        }),
        TODAY,
      ),
    ).toThrow('no network');
    // Nothing on the finding, the request still there, the checkout put away.
    expect(readFindingLines(ops)).toEqual(before);
    expect(last(disk).task).toBeUndefined();
    expect(state.taskRows).toHaveLength(1);
    expect(git(work, 'worktree', 'list').split('\n')).toHaveLength(1);

    // The next run gives it the id it would have had.
    expect(makeTaskRows(state, steps(), TODAY).made).toEqual([{ finding: disk, task: 'T-1946' }]);
  });

  it('keeps the id of a row whose write-back failed, and writes it on the next run without a second row', () => {
    const disk = add('ops-release', 'The disk of the server is nearly full');
    const state = accept(emptyState(), 1, disk);
    const first = makeTaskRows(
      state,
      steps({ seen: () => ({ ok: false, reason: 'the lock is held' }) }),
      TODAY,
    );
    expect(first.failures).toHaveLength(1);
    expect(first.state.taskRows).toMatchObject([
      { finding: disk, task: 'T-1946', pull_request: 'https://example.test/pull/1' },
    ]);
    expect(last(disk).task).toBeUndefined();

    const second = makeTaskRows(first.state, steps(), TODAY);
    expect(second).toMatchObject({ made: [], failures: [], pullRequest: null });
    expect(second.state.taskRows).toEqual([]);
    expect(opened).toHaveLength(1);
    expect(last(disk)).toMatchObject({ status: 'planned', task: 'T-1946' });
  });

  it("puts a withheld security finding's id in the row, and none of its text", () => {
    const weak = add('security', 'A response header is missing on the console');
    const state = accept(emptyState(), 1, weak);
    const result = makeTaskRows(state, steps(), TODAY);
    expect(result.made).toEqual([{ finding: weak, task: 'T-1946' }]);
    const text = onBranch(opened[0]!.branch);
    const row = text.split('\n').find((line) => line.includes('T-1946'))!;
    expect(row).toContain(`finding \`${weak}\`, security, major`);
    expect(row).toContain('withheld');
    for (const kept of ['header', 'evidence of', 'proposal for']) expect(text).not.toContain(kept);
    expect(opened[0]!.body).not.toContain('header');
    expect(last(weak)).toMatchObject({ status: 'planned', task: 'T-1946' });
  });
});
