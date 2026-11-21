import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type ConsoleState, type TriageRequest, emptyState } from './snapshot.ts';
import {
  SECTION,
  type TaskRowSteps,
  addRows,
  branchTaskIds,
  cell,
  checkout,
  currentBacklog,
  highestTaskId,
  makeTaskRows,
  nextTaskId,
  privateDraft,
  rowsBranch,
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

  it('takes the next id after the docs and the open branches, and passes a stray one over', () => {
    const branches = [
      'main',
      't-1946-mls-playoff-stages',
      't-1947-something',
      'T-1907-finding-triage',
      't-1950-task-rows-to-1952',
      'docs-phase-15-progress',
      'claude/t-1999-not-a-task-branch',
      't-999999-a-stray-name',
      't-x-nothing',
    ];
    expect(branchTaskIds(branches)).toEqual([1946, 1947, 1907, 1950, 1952, 999999]);
    // `main` ends at T-1945; open branches use ids up to T-1952.
    expect(nextTaskId([BACKLOG], branchTaskIds(branches))).toBe(1953);
    expect(nextTaskId([BACKLOG], [])).toBe(1946);
    // An id owed by an earlier run of this step counts; a private marker is no id.
    expect(nextTaskId([BACKLOG], [1946], ['T-1948', 'private:x.md'])).toBe(1949);
    expect(nextTaskId([BACKLOG], [999999])).toBe(1946);
  });

  it('names its branch by the ids it holds', () => {
    expect(rowsBranch([{ finding: 'a', task: 'T-1946' }])).toBe('t-1946-task-rows');
    expect(
      rowsBranch([
        { finding: 'a', task: 'T-1946' },
        { finding: 'b', task: 'T-1947' },
        { finding: 'c', task: 'T-1948' },
      ]),
    ).toBe('t-1946-task-rows-to-1948');
    expect(branchTaskIds(['t-1946-task-rows-to-1948'])).toEqual([1946, 1948]);
    expect(() => rowsBranch([{ finding: 'a', task: 'private:x' }])).toThrow();
  });

  it('keeps a text inside its cell, with nothing GitHub would link or notify', () => {
    expect(cell('a | b\nc `d` <script> \\')).toBe("a \\| b c 'd' &lt;script> \\\\");
    expect(cell('@someone see #123, [x](https://e.test) ![p](u) www.e.test')).toBe(
      '\\@someone see \\#123, \\[x\\](https:\\/\\/e.test) \\!\\[p\\](u) www\\.e.test',
    );
    expect([...cell('x'.repeat(700))]).toHaveLength(80);
  });

  it("writes the finding's id and severity, and nothing of its text", () => {
    const row = taskRow('T-1946', 'ops-2026-11-21-01', 'major');
    expect(row).toBe(
      '| `[ ]` T-1946 | Finding `ops-2026-11-21-01` (major), accepted on the agents console (D-456 point 2). The engineering session writes this row in full when it picks the task up | — | `- [ ]` written when the task is picked up |',
    );
    expect(row.split('\n')).toHaveLength(1);
    // What is not an id is not written as one.
    expect(() => taskRow('T-1946', 'x | @someone', 'major')).toThrow();
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

  it('drafts a security finding privately, without copying its evidence', () => {
    const draft = privateDraft(
      'sec-2026-11-21-01',
      { severity: 'critical', title: 'A header', evidence: 'curl -H x', proposal: 'Add it' },
      { finding: 'sec-2026-11-21-01', by: 'mostafa', at: 'x', command: ID(1) },
      TODAY,
    );
    expect(draft).toContain('PRIVATE');
    expect(draft).toContain('- Severity: critical');
    expect(draft).toContain('Add it');
    expect(draft).not.toContain('curl');
  });
});

describe('the task-row step, on a temp checkout', () => {
  let home = '';
  let work = '';
  let origin = '';
  let ops = '';
  let opened: { branch: string; title: string; body: string }[] = [];
  let finished: { id: string; status: string; outcome: string }[] = [];
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
        `evidence of: ${title}, seen in /opt/fmip on port 5432`,
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
    // The accept is not reported at the sync: the task-row step reports it.
    expect(applied.reports).toEqual([]);
    return applied.state;
  };
  const steps = (over: Partial<TaskRowSteps> = {}): TaskRowSteps => {
    const tree = checkout(work, {
      open: (branch, title, body) => {
        opened.push({ branch, title, body });
        return `https://example.test/pull/${opened.length}`;
      },
    });
    return {
      history: door().history,
      seen: door().seen,
      backlogs: tree.backlogs,
      branches: tree.branches,
      pullRequest: tree.pullRequest,
      writePrivate: (name, content) => {
        mkdirSync(join(ops, 'handoffs'), { recursive: true });
        writeFileSync(join(ops, 'handoffs', name), content);
      },
      finish: (id, status, outcome) => {
        finished.push({ id, status, outcome });
      },
      close: tree.close,
      ...over,
    };
  };
  const onBranch = (branch: string, file = 'docs/04-tasks-phase-15.md'): string =>
    git(origin, 'show', `${branch}:${file}`);
  const remoteBranches = (): string[] =>
    git(origin, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').sort();
  const localBranches = (): string[] =>
    git(work, 'for-each-ref', '--format=%(refname:short)', 'refs/heads').split('\n').sort();
  /** Everything that reached the public side: every branch's files, and every pull request's words. */
  const published = (): string =>
    [
      ...remoteBranches().map((branch) => git(origin, 'log', '-p', '--format=%B', branch)),
      ...opened.map((pr) => `${pr.branch}\n${pr.title}\n${pr.body}`),
      remoteBranches().join('\n'),
    ].join('\n');

  beforeEach(() => {
    opened = [];
    finished = [];
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
      drafted: 0,
      skipped: [],
      failures: [],
      pullRequest: 'https://example.test/pull/1',
    });
    expect(result.state.taskRows).toEqual([]);

    // One pull request, from a branch that changes the current backlog file alone.
    expect(opened).toHaveLength(1);
    const { branch, title, body } = opened[0]!;
    expect(branch).toBe('t-1946-task-rows');
    expect(title).toBe('docs: task row T-1946 for accepted findings');
    expect(body).toContain(`- T-1946: finding \`${disk}\``);
    expect(git(origin, 'diff', '--name-only', 'main', branch)).toBe('docs/04-tasks-phase-15.md');
    expect(git(origin, 'rev-list', '--count', `main..${branch}`)).toBe('1');
    const text = onBranch(branch);
    expect(text.startsWith(BACKLOG)).toBe(true);
    const rows = text.split('\n').filter((line) => line.includes('T-1946'));
    expect(rows).toEqual([
      `| \`[ ]\` T-1946 | Finding \`${disk}\` (major), accepted on the agents console (D-456 point 2). The engineering session writes this row in full when it picks the task up | — | \`- [ ]\` written when the task is picked up |`,
    ]);
    // The id and the severity, and nothing of what the agent wrote: no title, evidence, proposal, agent.
    for (const kept of ['disk', 'evidence of', '/opt/fmip', '5432', 'proposal for', 'ops-release'])
      expect(published()).not.toContain(kept);
    // `main` is as it was: the row waits for the pull request.
    expect(onBranch('main')).toBe(BACKLOG.trim());

    // The same id is on the finding's last line, which is still planned.
    expect(last(disk)).toMatchObject({ status: 'planned', task: 'T-1946', by: 'mostafa' });
    expect(
      door()
        .history(disk)
        .map((line) => line.status),
    ).toEqual(['new', 'planned', 'planned']);
    // The accept hears how it ended, with the pull request's address.
    expect(finished).toEqual([
      { id: ID(1), status: 'done', outcome: 'Planned; task T-1946: https://example.test/pull/1' },
    ]);

    // The working checkout was not touched, and keeps no branch of the step.
    expect(git(work, 'branch', '--show-current')).toBe('t-1-something');
    expect(git(work, 'status', '--porcelain')).toBe('?? notes.txt');
    expect(readFileSync(join(work, 'docs', '04-tasks-phase-15.md'), 'utf8')).toBe(BACKLOG);
    expect(git(work, 'worktree', 'list').split('\n')).toHaveLength(1);
    expect(localBranches()).toEqual(['main', 't-1-something']);
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
    expect(opened[0]).toMatchObject({
      branch: 't-1946-task-rows-to-1947',
      title: 'docs: task rows T-1946, T-1947 for accepted findings',
    });
    const text = onBranch(opened[0]!.branch);
    expect(text.match(/^\| `\[ \]` T-194[67] \|/gm)).toHaveLength(2);
    expect(git(origin, 'rev-list', '--count', `main..${opened[0]!.branch}`)).toBe('1');
    expect(last(disk)).toMatchObject({ task: 'T-1946', by: 'mostafa' });
    expect(last(score)).toMatchObject({ task: 'T-1947', by: 'teammate' });
    expect(finished.map((f) => f.id)).toEqual([ID(1), ID(2)]);

    // A later accept, with that pull request still open: its branch holds both ids.
    const slow = add('qa-engineer', 'The match page is slow on a phone');
    const later = makeTaskRows(accept(result.state, 3, slow), steps(), TODAY);
    expect(later.made).toEqual([{ finding: slow, task: 'T-1948' }]);
    expect(opened).toHaveLength(2);
  });

  it('takes the id after the ones open branches use, and is not moved by a task written on a finding', () => {
    // Two engineering branches are open, not merged: `main` still ends at T-1945.
    git(work, 'push', '--quiet', 'origin', 'main:t-1946-mls-playoff-stages');
    git(work, 'push', '--quiet', 'origin', 'main:t-1947-other-work');
    // Any agent can write a task on a finding: it claims nothing.
    add('qa-engineer', 'Something already tasked far away', ['--task', 'T-999999']);
    const disk = add('ops-release', 'The disk of the server is nearly full');
    const result = makeTaskRows(accept(emptyState(), 1, disk), steps(), TODAY);
    expect(result.made).toEqual([{ finding: disk, task: 'T-1948' }]);
    expect(opened[0]?.branch).toBe('t-1948-task-rows');
  });

  it('adds no row for a finding that already has a task, or that is no longer planned', () => {
    const tasked = add('ops-release', 'The disk of the server is nearly full', [
      '--task',
      'T-1907',
    ]);
    const gone = add('data-auditor', 'A final score differs from the official one');
    // An accept of a finding with its task is settled at the sync and asks for nothing.
    const direct = applyTriage(
      {
        ...emptyState(),
        triage: [
          {
            id: ID(1),
            kind: 'finding.accept',
            finding: tasked,
            reason: '',
            until: '',
            by: 'mostafa',
            at: 'x',
          },
        ],
      },
      door(),
      TODAY,
    );
    expect(direct.state.taskRows).toEqual([]);
    expect(direct.reports).toMatchObject([{ id: ID(1), status: 'done' }]);
    let state = accept(direct.state, 2, gone);
    // A request left for a finding that got its task, or was snoozed since, makes none.
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
            until: '2026-11-25',
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
      'It is no longer planned.',
      'It already has a task.',
      'No such finding on the computer.',
    ]);
    expect(result.state.taskRows).toEqual([]);
    expect(opened).toEqual([]);
    expect(remoteBranches()).toEqual(['main']);
    expect(readFindingLines(ops)).toHaveLength(lines);
    // Each accept still hears how it ended.
    expect(finished.map((f) => [f.id, f.outcome])).toEqual([
      [ID(2), 'Planned; no task was made: It is no longer planned.'],
      [ID(3), 'Planned; no task was made: It already has a task.'],
      [ID(4), 'Planned; no task was made: No such finding on the computer.'],
    ]);
  });

  it('can be run again after the pull request failed: same id, no branch left behind', () => {
    const disk = add('ops-release', 'The disk of the server is nearly full');
    const state = accept(emptyState(), 1, disk);
    const before = readFindingLines(ops);
    // The real checkout: the commit and the push succeed, opening the pull request fails.
    const failing = () => {
      const tree = checkout(work, {
        open: () => {
          throw new Error('gh pr failed: no network');
        },
      });
      return steps({
        backlogs: tree.backlogs,
        branches: tree.branches,
        pullRequest: tree.pullRequest,
        close: tree.close,
      });
    };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const failed = makeTaskRows(state, failing(), TODAY);
      expect(failed.failures).toEqual([
        'The docs pull request was not opened: gh pr failed: no network',
      ]);
      // No id is claimed: nothing on the finding, nothing reported, the request kept.
      expect(failed.made).toEqual([]);
      expect(failed.state.taskRows).toEqual(state.taskRows);
      expect(readFindingLines(ops)).toEqual(before);
      expect(finished).toEqual([]);
      // Nothing is left behind, here or on origin.
      expect(remoteBranches()).toEqual(['main']);
      expect(localBranches()).toEqual(['main']);
      expect(git(work, 'worktree', 'list').split('\n')).toHaveLength(1);
    }

    // The next run gives it the id it would have had.
    const result = makeTaskRows(state, steps(), TODAY);
    expect(result).toMatchObject({ made: [{ finding: disk, task: 'T-1946' }], failures: [] });
    expect(remoteBranches()).toEqual(['main', 't-1946-task-rows']);
  });

  it('takes over a branch a stopped run left here, and steps past one it left on origin', () => {
    const disk = add('ops-release', 'The disk of the server is nearly full');
    const state = accept(emptyState(), 1, disk);
    // A run that died after `git switch -c`: the branch exists locally, with another commit.
    git(work, 'branch', 't-1946-task-rows', 'main');
    const first = makeTaskRows(state, steps(), TODAY);
    expect(first).toMatchObject({ made: [{ finding: disk, task: 'T-1946' }], failures: [] });

    // A run that died after the push and could not clean up: the branch is on origin with no pull request.
    const score = add('data-auditor', 'A final score differs from the official one');
    git(work, 'push', '--quiet', 'origin', 'main:t-1947-task-rows');
    const second = makeTaskRows(accept(first.state, 2, score), steps(), TODAY);
    expect(second).toMatchObject({ made: [{ finding: score, task: 'T-1948' }], failures: [] });
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
    expect(finished).toEqual([]);

    const second = makeTaskRows(first.state, steps(), TODAY);
    expect(second).toMatchObject({ made: [], failures: [], pullRequest: null });
    expect(second.state.taskRows).toEqual([]);
    expect(opened).toHaveLength(1);
    expect(last(disk)).toMatchObject({ status: 'planned', task: 'T-1946' });
    expect(finished).toEqual([
      { id: ID(1), status: 'done', outcome: 'Planned; task T-1946: https://example.test/pull/1' },
    ]);
  });

  it('sends a report that failed again on the next run, and nothing else', () => {
    const disk = add('ops-release', 'The disk of the server is nearly full');
    const first = makeTaskRows(
      accept(emptyState(), 1, disk),
      steps({
        finish: () => {
          throw new Error('ssh fmip-prod failed: refused');
        },
      }),
      TODAY,
    );
    expect(first.failures).toHaveLength(1);
    expect(first.state.taskRows).toMatchObject([{ finding: disk, task: 'T-1946' }]);
    const lines = readFindingLines(ops).length;
    const second = makeTaskRows(first.state, steps(), TODAY);
    expect(second.state.taskRows).toEqual([]);
    expect(finished).toHaveLength(1);
    expect(opened).toHaveLength(1);
    expect(readFindingLines(ops)).toHaveLength(lines);
  });

  it('gives a security finding no public row and no word in the pull request, marked public or not', () => {
    const weak = add('security', 'A response header is missing on the console');
    const shown = add('security', 'An old cookie flag');
    // Marked public for the console: that is the console's two people, not the repository.
    const marked = spawnSync(
      process.execPath,
      [
        SCRIPT,
        'seen',
        shown,
        '--status',
        'open',
        '--evidence',
        'shown',
        '--public',
        'true',
        '--by',
        'mostafa',
      ],
      { env: env(), encoding: 'utf8' },
    );
    expect(marked.status).toBe(0);
    const disk = add('ops-release', 'The disk of the server is nearly full');
    let state = accept(emptyState(), 1, weak);
    state = accept(state, 2, shown);
    state = accept(state, 3, disk);

    const result = makeTaskRows(state, steps(), TODAY);
    expect(result).toMatchObject({
      made: [{ finding: disk, task: 'T-1946' }],
      drafted: 2,
      failures: [],
    });
    expect(result.state.taskRows).toEqual([]);

    // Nothing public says a security finding exists: no row, no branch name, no title, no body.
    const everything = published();
    for (const kept of [weak, shown, 'sec-', 'security', 'header', 'cookie', 'private'])
      expect(everything).not.toContain(kept);
    expect(onBranch(opened[0]!.branch).match(/^\| `\[ \]` T-\d+ \|/gm)).toHaveLength(3);

    // The task is a private file under the ops folder, and the finding carries a marker, not an id.
    expect(readdirSync(join(ops, 'handoffs')).sort()).toEqual([
      `${TODAY}-task-${weak}.md`,
      `${TODAY}-task-${shown}.md`,
    ]);
    expect(readFileSync(join(ops, 'handoffs', `${TODAY}-task-${weak}.md`), 'utf8')).toContain(
      'PRIVATE',
    );
    expect(existsSync(join(work, 'handoffs'))).toBe(false);
    for (const id of [weak, shown]) {
      expect(last(id)).toMatchObject({
        status: 'planned',
        task: `private:${TODAY}-task-${id}.md`,
      });
    }
    // Its accept is reported without an address.
    expect(finished.filter((f) => f.id !== ID(3)).map((f) => f.outcome)).toEqual([
      "Planned; its task is drafted privately on the maintainer's computer.",
      "Planned; its task is drafted privately on the maintainer's computer.",
    ]);

    // Security findings alone open no pull request at all.
    opened = [];
    const other = add('security', 'A third weakness');
    const alone = makeTaskRows(accept(result.state, 4, other), steps(), TODAY);
    expect(alone).toMatchObject({ made: [], drafted: 1, pullRequest: null, failures: [] });
    expect(opened).toEqual([]);
  });
});
