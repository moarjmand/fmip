import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { isSecurityFinding } from './redact.ts';
import type { ConsoleState, TaskRowRequest } from './snapshot.ts';
import { type SeenResult, TRIAGE_BY, FINDING_ID, statusOn } from './triage.ts';

/**
 * The `task-row` step (T-1907, D-456 point 2 and its addition of 2026-11-21):
 * an accepted finding gets its task by itself. Run on the maintainer's
 * computer by a Claude session of the engineering session's kind, never by
 * one of the sixteen agents (their guard forbids repository writes):
 *
 *     node packages/console-publisher/src/publish.ts task-row
 *
 * The repository is public and a finding is not. So:
 *
 *   - A finding that is NOT a security finding gets one row in the current
 *     backlog file that carries its id and its severity and nothing else: no
 *     title, evidence, proposal or check. The engineering session writes the
 *     public description when it picks the task up. All the rows of one run
 *     go in ONE docs pull request, whose title and body name ids alone; each
 *     id is then written back onto its finding (`task`).
 *   - A SECURITY finding (the security agent's, or an id `sec-...`, marked
 *     public or not) gets no row, and no word in the pull request: its task
 *     is drafted in a file under the ops folder (`handoffs/`), which never
 *     leaves the computer through this step, and the finding gets a private
 *     marker (`private:<file>`) in place of a task id.
 *
 * It starts no work on a task, and reports each accept command's outcome to
 * the server when its task exists. A finding that already has a task, or
 * that is no longer `planned`, gets none.
 */

/** The section the rows go to, at the end of the current backlog file. */
export const SECTION = '## Accepted findings (console triage, D-456)';
const SECTION_INTRO =
  'Rows written by the `task-row` step of the console publisher (T-1907) when a person accepts a\n' +
  'finding on the agents console. Each names the finding and its severity only: the engineering\n' +
  'session writes the description, the file list and the acceptance criteria when it picks it up.';
const TABLE_HEAD = '| ID | Task | Deps | Acceptance |\n|---|---|---|---|';
const SEVERITIES = ['critical', 'major', 'minor', 'info'];
/** A branch's id further than this above the docs' highest is a stray name, not a task. */
export const BRANCH_ID_WINDOW = 500;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The highest `T-n` the texts name, 0 when none. */
export function highestTaskId(texts: readonly string[]): number {
  let highest = 0;
  for (const body of texts)
    for (const match of body.matchAll(/\bT-(\d{1,6})\b/g))
      highest = Math.max(highest, Number(match[1]));
  return highest;
}

/**
 * The task ids the names of `origin`'s branches claim: `t-<id>-<slug>` (the
 * project's rule for a task's branch), and both ends of this step's own
 * `t-<first>-task-rows-to-<last>`.
 */
export function branchTaskIds(branches: readonly string[]): number[] {
  const ids: number[] = [];
  for (const name of branches) {
    const first = /^t-(\d{1,6})-/i.exec(name)?.[1];
    if (first === undefined) continue;
    ids.push(Number(first));
    const last = /-task-rows-to-(\d{1,6})$/i.exec(name)?.[1];
    if (last !== undefined) ids.push(Number(last));
  }
  return ids;
}

/**
 * The next free task id: one more than the highest in the backlog files of
 * `main`, on a branch of `origin` (work or rows not merged yet), or owed by
 * this step. A finding's own `task` is never read for this: any agent can
 * write one. A branch id far above the docs is passed over.
 */
export function nextTaskId(
  backlogs: readonly string[],
  branchIds: readonly number[],
  owed: readonly string[] = [],
): number {
  const inDocs = highestTaskId(backlogs);
  const onBranches = branchIds.filter((id) => id <= inDocs + BRANCH_ID_WINDOW);
  return Math.max(inDocs, highestTaskId(owed), ...onBranches) + 1;
}

/** The current backlog: `04-tasks-phase-<N>.md` with the highest N. */
export function currentBacklog(names: readonly string[]): string | null {
  let best: { name: string; phase: number } | null = null;
  for (const name of names) {
    const phase = /^04-tasks-phase-(\d+)\.md$/.exec(name)?.[1];
    if (phase !== undefined && (best === null || Number(phase) > best.phase))
      best = { name, phase: Number(phase) };
  }
  return best?.name ?? null;
}

/**
 * Text as one cell of a Markdown table on GitHub: one line, nothing that
 * breaks the cell or a code span, and nothing GitHub turns into a mention,
 * an issue link, a link or a picture (`@`, `#`, brackets, `!`, a bare URL).
 */
export function cell(value: string, max = 80): string {
  const flat = value
    .replace(/\s+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/[|@#[\]!*_~]/g, (c) => `\\${c}`)
    .replace(/`/g, "'")
    .replace(/</g, '&lt;')
    .replace(/:\/\//g, ':\\/\\/')
    .replace(/\bwww\./gi, 'www\\.')
    .trim();
  const chars = [...flat];
  return chars.length <= max ? flat : `${chars.slice(0, max - 1).join('')}…`;
}

/** A severity out of the fixed list, or `unknown`: never a word a finding line invented. */
export const severityOf = (record: Record<string, unknown>): string =>
  SEVERITIES.find((s) => s === record.severity) ?? 'unknown';

/** One backlog row for an accepted finding: its id and its severity, nothing of its text. */
export function taskRow(task: string, finding: string, severity: string): string {
  if (!FINDING_ID.test(finding)) throw new Error('A row names a finding by its id.');
  return `| \`[ ]\` ${task} | Finding \`${finding}\` (${cell(severity, 20)}), accepted on the agents console (D-456 point 2). The engineering session writes this row in full when it picks the task up | — | \`- [ ]\` written when the task is picked up |`;
}

/** The backlog with the rows added to its triage section, which is made at the end when missing. */
export function addRows(backlog: string, rows: readonly string[]): string {
  if (rows.length === 0) return backlog;
  const lines = backlog.split('\n');
  const at = lines.findIndex((line) => line.trim() === SECTION);
  if (at === -1) {
    const body = backlog.endsWith('\n') ? backlog : `${backlog}\n`;
    return `${body}\n${SECTION}\n\n${SECTION_INTRO}\n\n${TABLE_HEAD}\n${rows.join('\n')}\n`;
  }
  // After the section's last table line, before the next heading.
  let end = lines.length;
  for (let i = at + 1; i < lines.length; i += 1) {
    if (/^#{1,6}\s/.test(lines[i]!)) {
      end = i;
      break;
    }
  }
  let last = -1;
  for (let i = at + 1; i < end; i += 1) if (lines[i]!.startsWith('|')) last = i;
  if (last === -1) {
    lines.splice(at + 1, 0, '', ...TABLE_HEAD.split('\n'), ...rows);
  } else {
    lines.splice(last + 1, 0, ...rows);
  }
  return lines.join('\n');
}

/** The marker a security finding carries in place of a task id. */
export const privateMarker = (file: string): string => `private:${file}`;
export const privateDraftName = (finding: string, today: string): string =>
  `${today}-task-${finding}.md`;

/**
 * The private draft of a security finding's task. It stays under the ops
 * folder; the finding's own lines, in the same folder, hold the evidence.
 */
export function privateDraft(
  finding: string,
  record: Record<string, unknown>,
  request: TaskRowRequest,
  today: string,
): string {
  return [
    `# Task draft for security finding ${finding}`,
    '',
    'PRIVATE. Not for the public repository: no task row and no pull request names this finding',
    '(D-456, the maintainer on 2026-11-21). The maintainer decides in his own session how the work',
    'is described in public, if at all.',
    '',
    `- Finding: ${finding}`,
    `- Severity: ${severityOf(record)}`,
    `- Accepted on the agents console by ${request.by} on ${today} (console command ${request.command})`,
    `- Title: ${text(record.title).replace(/\s+/g, ' ')}`,
    '',
    '## Proposal, as the finding has it',
    '',
    text(record.proposal) || '(none written)',
    '',
    '## Evidence',
    '',
    `Read the lines of ${finding} in the findings folder; they are not copied here.`,
    '',
    'No work on this has started.',
    '',
  ].join('\n');
}

export interface MadeRow {
  finding: string;
  task: string;
}

/** What the step does outside this file, so it is tested with stand-ins or on a temp checkout. */
export interface TaskRowSteps {
  /** Every line of that finding, oldest first. */
  history(finding: string): Record<string, unknown>[];
  /** The backlog files of the newest `main` (`docs/04-tasks-*.md`). */
  backlogs(): { name: string; text: string }[];
  /** The names of `origin`'s branches. */
  branches(): string[];
  /** Writes the file, commits, pushes and opens the docs pull request; its address. Throws when it cannot. */
  pullRequest(name: string, content: string, made: readonly MadeRow[]): string;
  /** Writes a private draft under the ops folder's `handoffs/`. */
  writePrivate(name: string, content: string): void;
  seen(args: (evidenceFile: string) => string[], evidence: string): SeenResult;
  /** Reports an accept command's outcome to the server; may throw. */
  finish(id: string, status: 'done' | 'failed', outcome: string): void;
  /** Puts away whatever `backlogs` opened. */
  close?(): void;
}

export interface TaskRowResult {
  state: ConsoleState;
  /** The public rows made by this run. */
  made: MadeRow[];
  /** How many security findings got a private draft; never which. */
  drafted: number;
  /** Requests that got no task, and why. */
  skipped: { finding: string; reason: string }[];
  pullRequest: string | null;
  /** What went wrong; each request it concerns is kept for the next run. */
  failures: string[];
}

const COMMAND_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const reasonOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

const writeBackArgs =
  (request: TaskRowRequest, task: string) =>
  (file: string): string[] => [
    'seen',
    request.finding,
    '--status',
    'planned',
    '--task',
    task,
    '--evidence-file',
    file,
    '--by',
    request.by,
  ];

/**
 * Makes the tasks `state.taskRows` asks for. Nothing here throws for a step
 * that failed: the failure is named and its request kept, so the next run
 * takes it up where it stopped.
 *
 *   - no id is on a finding unless its row is in an opened pull request;
 *   - a write-back that fails keeps its id and is written by the next run
 *     without a second row;
 *   - a report that fails keeps its outcome and is sent by the next run.
 */
export function makeTaskRows(
  state: ConsoleState,
  steps: TaskRowSteps,
  today: string = new Date().toISOString().slice(0, 10),
): TaskRowResult {
  const result: TaskRowResult = {
    state: structuredClone(state),
    made: [],
    drafted: 0,
    skipped: [],
    pullRequest: null,
    failures: [],
  };
  /** Requests whose task exists (a row in a pull request, or a private draft) and is owed to the finding. */
  const owed: TaskRowRequest[] = [];
  /** Requests with nothing left but the report to the server. */
  const settled: TaskRowRequest[] = [];
  const left: TaskRowRequest[] = [];
  const wanted: { request: TaskRowRequest; severity: string }[] = [];
  const skip = (request: TaskRowRequest, reason: string) => {
    result.skipped.push({ finding: String(request.finding), reason });
    settled.push({ ...request, outcome: `Planned; no task was made: ${reason}` });
  };
  try {
    for (const request of result.state.taskRows ?? []) {
      if (!FINDING_ID.test(request.finding) || !TRIAGE_BY.test(request.by)) {
        result.skipped.push({
          finding: String(request.finding),
          reason: 'The request names no finding or no person.',
        });
        continue;
      }
      if (request.outcome !== undefined) {
        settled.push(request);
        continue;
      }
      if (request.task !== undefined) {
        owed.push(request);
        continue;
      }
      const record = steps.history(request.finding).at(-1);
      if (record === undefined) skip(request, 'No such finding on the computer.');
      else if (text(record.task) !== '') skip(request, 'It already has a task.');
      else if (statusOn(record, today) !== 'planned') skip(request, 'It is no longer planned.');
      else if (
        wanted.some((w) => w.request.finding === request.finding) ||
        owed.some((o) => o.finding === request.finding)
      )
        skip(request, 'Asked for twice; one task is made.');
      else if (isSecurityFinding(request.finding, text(record.agent))) {
        // Private: a file under the ops folder, and a marker on the finding. Nothing public.
        const name = privateDraftName(request.finding, today);
        try {
          steps.writePrivate(name, privateDraft(request.finding, record, request, today));
          owed.push({ ...request, task: privateMarker(name) });
          result.drafted += 1;
        } catch (error) {
          result.failures.push(`A private draft was not written: ${reasonOf(error)}`);
          left.push(request);
        }
      } else wanted.push({ request, severity: severityOf(record) });
    }

    if (wanted.length > 0) {
      try {
        const backlogs = steps.backlogs();
        const name = currentBacklog(backlogs.map((file) => file.name));
        const backlog = backlogs.find((file) => file.name === name);
        if (backlog === undefined)
          throw new Error('No docs/04-tasks-phase-<N>.md to add a row to.');
        let next = nextTaskId(
          backlogs.map((file) => file.text),
          branchTaskIds(steps.branches()),
          owed.map((request) => request.task ?? ''),
        );
        const made: MadeRow[] = [];
        const rows: string[] = [];
        for (const { request, severity } of wanted) {
          const task = `T-${next}`;
          next += 1;
          rows.push(taskRow(task, request.finding, severity));
          made.push({ finding: request.finding, task });
        }
        const address = steps.pullRequest(backlog.name, addRows(backlog.text, rows), made);
        result.made = made;
        result.pullRequest = address;
        wanted.forEach(({ request }, i) =>
          owed.push({ ...request, task: made[i]!.task, pull_request: address }),
        );
      } catch (error) {
        // No id was claimed: the requests wait for the next run.
        result.failures.push(`The docs pull request was not opened: ${reasonOf(error)}`);
        left.push(...wanted.map((w) => w.request));
      }
    }

    // The task goes back onto the finding: one more line, the same id.
    for (const request of owed) {
      const task = request.task!;
      const isPrivate = task.startsWith('private:');
      const already = text(steps.history(request.finding).at(-1)?.task) === task;
      const written = already
        ? ({ ok: true } as const)
        : steps.seen(
            writeBackArgs(request, task),
            isPrivate
              ? `Its task is drafted privately on the maintainer's computer (${task.slice('private:'.length)} under handoffs/), asked by console command ${request.command}. No public row. No work on it has started.`
              : `Task row ${task} added to the backlog for this finding${
                  request.pull_request === undefined ? '' : ` (${request.pull_request})`
                }, asked by console command ${request.command}. No work on it has started.`,
          );
      if (!written.ok) {
        result.failures.push(
          isPrivate
            ? `A private draft was made but not marked on its finding: ${written.reason}`
            : `${request.finding}: ${task} is in the pull request but was not written on the finding: ${written.reason}`,
        );
        left.push(request);
        continue;
      }
      settled.push({
        ...request,
        outcome: isPrivate
          ? "Planned; its task is drafted privately on the maintainer's computer."
          : `Planned; task ${task}${request.pull_request === undefined ? '' : `: ${request.pull_request}`}`,
      });
    }

    // Each accept command hears how it ended.
    for (const request of settled) {
      if (!COMMAND_UUID.test(request.command)) continue;
      try {
        steps.finish(request.command, 'done', request.outcome!);
      } catch (error) {
        result.failures.push(
          `Command ${request.command} is done here, but its outcome did not reach the server: ${reasonOf(error)}`,
        );
        left.push(request);
      }
    }
    result.state.taskRows = left;
    return result;
  } finally {
    steps.close?.();
  }
}

// --- The checkout and the pull request, for real ------------------------------

/** Runs a program with its arguments and no shell; throws with what it said when it fails. */
export type Run = (program: string, args: readonly string[], cwd: string) => string;

export const run: Run = (program, args, cwd) => {
  const result = spawnSync(program, [...args], { cwd, encoding: 'utf8', timeout: 120_000 });
  if (result.status !== 0) {
    throw new Error(
      `${program} ${args[0] ?? ''} failed: ${(result.stderr || result.error?.message || String(result.status)).trim().slice(0, 400)}`,
    );
  }
  return result.stdout;
};

export interface Checkout {
  backlogs(): { name: string; text: string }[];
  branches(): string[];
  pullRequest(name: string, content: string, made: readonly MadeRow[]): string;
  close(): void;
}

/** The step's branch: `t-<first id>-task-rows`, with `-to-<last id>` when it holds several rows. */
export function rowsBranch(made: readonly MadeRow[]): string {
  const numbers = made.map((row) => /^T-(\d+)$/.exec(row.task)?.[1]);
  if (numbers.length === 0 || numbers.some((n) => n === undefined))
    throw new Error('A pull request needs its task ids.');
  const first = numbers[0]!;
  const last = numbers.at(-1)!;
  return first === last ? `t-${first}-task-rows` : `t-${first}-task-rows-to-${last}`;
}

/**
 * A fresh checkout of `origin/main` beside the working one (`git worktree`),
 * so the maintainer's own checkout, whatever branch and changes it holds, is
 * not touched. The commit holds the backlog file alone. `open` opens the pull
 * request (GitHub's `gh` by default) and answers its address.
 *
 * It can be run again after any failure: the branch is made with `switch -C`
 * (a branch left by a run that stopped is taken over), and when the commit,
 * the push or the pull request fails, the branch is deleted here and, once
 * pushed, on `origin`, so the next run starts clean with the same id. Should
 * that clean-up fail too, the branch left on `origin` only makes the next run
 * take the following id (`branchTaskIds`).
 */
export function checkout(
  root: string,
  options: {
    exec?: Run;
    /** Opens the pull request for the pushed branch; the default runs `gh pr create`. */
    open?: (branch: string, title: string, body: string, cwd: string) => string;
  } = {},
): Checkout {
  const exec = options.exec ?? run;
  const open =
    options.open ??
    ((branch, title, body, cwd) => {
      const folder = mkdtempSync(join(tmpdir(), 'fmip-task-row-pr-'));
      try {
        const file = join(folder, 'body.md');
        writeFileSync(file, body);
        return exec(
          'gh',
          [
            'pr',
            'create',
            '--base',
            'main',
            '--head',
            branch,
            '--title',
            title,
            '--body-file',
            file,
          ],
          cwd,
        ).trim();
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    });
  let tree: string | null = null;
  const made = new Set<string>();
  const quietly = (program: string, args: readonly string[], cwd: string): void => {
    try {
      exec(program, args, cwd);
    } catch {
      // Clean-up is best effort; the next run does not depend on it.
    }
  };
  const worktree = (): string => {
    if (tree !== null) return tree;
    exec('git', ['fetch', '--quiet', '--prune', 'origin'], root);
    const folder = join(mkdtempSync(join(tmpdir(), 'fmip-task-row-')), 'checkout');
    exec('git', ['worktree', 'add', '--quiet', '--detach', folder, 'origin/main'], root);
    tree = folder;
    return folder;
  };
  return {
    backlogs: () => {
      const docs = join(worktree(), 'docs');
      return (existsSync(docs) ? readdirSync(docs) : [])
        .filter((name) => /^04-tasks-.*\.md$/.test(name))
        .sort()
        .map((name) => ({ name, text: readFileSync(join(docs, name), 'utf8') }));
    },
    branches: () =>
      exec('git', ['ls-remote', '--heads', 'origin'], root)
        .split('\n')
        .map((line) => /\trefs\/heads\/(.+)$/.exec(line)?.[1] ?? '')
        .filter((name) => name !== ''),
    pullRequest: (name, content, rows) => {
      const cwd = worktree();
      const ids = rows.map((row) => row.task);
      const branch = rowsBranch(rows);
      const title = `docs: task row${ids.length === 1 ? '' : 's'} ${ids.join(', ')} for accepted findings`;
      const body = [
        'Rows added by the `task-row` step of the console publisher (T-1907, D-456 point 2): each',
        'finding below was accepted on the agents console. A row names the finding and its severity',
        'only; the engineering session writes it in full when it picks the task up. No work has started.',
        '',
        ...rows.map((row) => `- ${row.task}: finding \`${row.finding}\``),
        '',
      ].join('\n');
      let pushed = false;
      made.add(branch);
      try {
        exec('git', ['switch', '--quiet', '-C', branch, 'origin/main'], cwd);
        writeFileSync(join(cwd, 'docs', name), content);
        exec('git', ['add', '--', `docs/${name}`], cwd);
        exec('git', ['commit', '--quiet', '-m', title], cwd);
        exec('git', ['push', '--quiet', '-u', 'origin', branch], cwd);
        pushed = true;
        return open(branch, title, body, cwd);
      } catch (error) {
        if (pushed) quietly('git', ['push', '--quiet', 'origin', '--delete', branch], cwd);
        throw error;
      }
    },
    close: () => {
      if (tree !== null) {
        const folder = tree;
        tree = null;
        try {
          exec('git', ['worktree', 'remove', '--force', folder], root);
        } catch {
          rmSync(folder, { recursive: true, force: true });
          quietly('git', ['worktree', 'prune'], root);
        }
      }
      // The branch is on `origin` (or was given up): no copy of it is kept here.
      for (const branch of made) quietly('git', ['branch', '-D', branch], root);
      made.clear();
    },
  };
}
