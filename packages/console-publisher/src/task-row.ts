import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConsoleState, TaskRowRequest } from './snapshot.ts';
import { type SeenResult, TRIAGE_BY, FINDING_ID, statusOn } from './triage.ts';

/**
 * The `task-row` step (T-1907, D-456 point 2): an accepted finding gets its
 * row in the backlog by itself. Run on the maintainer's computer by a Claude
 * session of the engineering session's kind, never by one of the sixteen
 * agents (their guard forbids repository writes):
 *
 *     node packages/console-publisher/src/publish.ts task-row
 *
 * For every finding `sync` left in `state.taskRows` it takes the next free
 * task id, adds one row (the finding's id, evidence and proposal) to the
 * current backlog file, opens ONE docs pull request with all of them, and
 * writes each id back onto its finding (`task`) through `finding.mjs seen`.
 * It starts no work on the task. A finding that already has a task, or that
 * is no longer `planned`, gets no row.
 *
 * The repository is public: a security finding whose detail is withheld
 * (D-455 point 2) gets a row with its id alone, and every other text passes
 * the same rule (`guard`) before it is written.
 */

/** The section the rows go to, at the end of the current backlog file. */
export const SECTION = '## Accepted findings (console triage, D-456)';
const SECTION_INTRO =
  'Rows written by the `task-row` step of the console publisher (T-1907) when a person accepts a\n' +
  'finding on the agents console. Each is a stub from the finding as its agent wrote it: it is\n' +
  'written in full, with its file list and its real acceptance criteria, when it is picked up.';
const TABLE_HEAD = '| ID | Task | Deps | Acceptance |\n|---|---|---|---|';
/** The longest a finding's text is in a row's cell. */
export const CELL_MAX = 600;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** The highest `T-n` the texts name, 0 when none. */
export function highestTaskId(texts: readonly string[]): number {
  let highest = 0;
  for (const body of texts)
    for (const match of body.matchAll(/\bT-(\d{1,6})\b/g))
      highest = Math.max(highest, Number(match[1]));
  return highest;
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

/** Text as one cell of a Markdown table: one line, no cell or code-span break, cut. */
export function cell(value: string, max = CELL_MAX): string {
  const flat = value
    .replace(/\s+/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/`/g, "'")
    .replace(/</g, '&lt;')
    .trim();
  const chars = [...flat];
  return chars.length <= max ? flat : `${chars.slice(0, max - 1).join('')}…`;
}

export interface RowSource {
  /** The finding's latest line. */
  record: Record<string, unknown>;
  /** A security finding whose detail stays on the computer. */
  withheld: boolean;
}

/** What stands in a row for a text that names a withheld security finding. */
export const WITHHELD_TEXT =
  "(withheld: it names a security finding whose detail stays on the maintainer's computer, D-455)";

/**
 * One backlog row for an accepted finding. `guard` is the security text rule
 * (`guardText`): a title, evidence, proposal or check it would change is left
 * out whole, since the row is read by anyone.
 */
export function taskRow(
  task: string,
  finding: string,
  source: RowSource,
  guard: (value: string) => string = (value) => value,
): string {
  const { withheld } = source;
  const record: Record<string, unknown> = { ...source.record };
  for (const key of ['title', 'evidence', 'proposal', 'verify']) {
    const value = text(record[key]);
    if (value !== '' && guard(value) !== value) record[key] = WITHHELD_TEXT;
  }
  const from = `finding \`${finding}\`, ${cell(text(record.agent), 40)}, ${cell(text(record.severity), 20)}; accepted on the agents console, D-456 point 2`;
  if (withheld) {
    return `| \`[ ]\` ${task} | A security finding (${from}). Its title and detail are withheld here (D-455 point 2): read the finding on the maintainer's computer | — | \`- [ ]\` the security agent re-checks the finding and marks it \`resolved\` |`;
  }
  const parts = [
    `${cell(text(record.title), 200)} (${from})`,
    text(record.evidence) === '' ? '' : `Evidence: ${cell(text(record.evidence))}`,
    text(record.proposal) === '' ? '' : `Proposal: ${cell(text(record.proposal))}`,
  ].filter((part) => part !== '');
  const check =
    text(record.verify) === ''
      ? `the finding's agent re-checks it and marks it \`resolved\``
      : cell(text(record.verify), 300);
  return `| \`[ ]\` ${task} | ${parts.join('. ')} | — | \`- [ ]\` ${check} |`;
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

export interface MadeRow {
  finding: string;
  task: string;
}

/** What the step does outside this file, so it is tested with stand-ins or on a temp checkout. */
export interface TaskRowSteps {
  /** Every line of that finding, oldest first. */
  history(finding: string): Record<string, unknown>[];
  /** Whether that finding's detail stays on the computer (D-455 point 2). */
  withheld(finding: string, agent: string): boolean;
  /** Any text bound for the public repository, after the security text rule. */
  guard(value: string): string;
  /** Every `task` any finding line carries: ids already given out, merged or not. */
  findingTasks(): string[];
  /** The backlog files of the newest `main` (`docs/04-tasks-*.md`). */
  backlogs(): { name: string; text: string }[];
  /** Writes the file, commits, pushes and opens the docs pull request; its address. Throws when it cannot. */
  pullRequest(name: string, content: string, made: readonly MadeRow[]): string;
  seen(args: (evidenceFile: string) => string[], evidence: string): SeenResult;
  /** Puts away whatever `backlogs` opened. */
  close?(): void;
}

export interface TaskRowResult {
  state: ConsoleState;
  made: MadeRow[];
  /** Requests that got no row, and why. */
  skipped: { finding: string; reason: string }[];
  pullRequest: string | null;
  /** What went wrong after the pull request was opened; the request is kept for the next run. */
  failures: string[];
}

type Pending = TaskRowRequest;

const writeBackArgs =
  (request: Pending, task: string) =>
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
 * Makes the rows `state.taskRows` asks for. No id is taken unless the pull
 * request was opened: when `pullRequest` throws, this throws and the caller
 * keeps the state it had. The rows are in the docs before any id is written
 * on a finding; a write-back that fails keeps its request, with its id, and
 * the next run writes it without a second row.
 */
export function makeTaskRows(
  state: ConsoleState,
  steps: TaskRowSteps,
  today: string = new Date().toISOString().slice(0, 10),
): TaskRowResult {
  const result: TaskRowResult = {
    state: structuredClone(state),
    made: [],
    skipped: [],
    pullRequest: null,
    failures: [],
  };
  const requests = result.state.taskRows ?? [];
  const kept: Pending[] = [];
  const wanted: { request: Pending; source: RowSource }[] = [];
  const skip = (finding: string, reason: string) => result.skipped.push({ finding, reason });
  try {
    for (const request of requests) {
      if (!FINDING_ID.test(request.finding) || !TRIAGE_BY.test(request.by)) {
        skip(String(request.finding), 'The request names no finding or no person.');
        continue;
      }
      // A row made by a run whose write-back failed: only the write-back is left.
      if (request.task !== undefined) {
        kept.push(request);
        continue;
      }
      const history = steps.history(request.finding);
      const latest = history.at(-1);
      // The evidence is the agent's own: a person's triage line (`by`) says who decided, not what was seen.
      const seenBy = history.findLast((line) => text(line.by) === '');
      const record: Record<string, unknown> | undefined =
        latest === undefined ? undefined : { ...latest, evidence: (seenBy ?? latest).evidence };
      if (record === undefined) skip(request.finding, 'No such finding on the computer.');
      else if (text(record.task) !== '')
        skip(request.finding, `It already has the task ${text(record.task)}.`);
      else if (statusOn(record, today) !== 'planned')
        skip(request.finding, `It is no longer planned (${text(record.status)}).`);
      else if (wanted.some((w) => w.request.finding === request.finding))
        skip(request.finding, 'Asked for twice; one row is made.');
      else
        wanted.push({
          request,
          source: { record, withheld: steps.withheld(request.finding, text(record.agent)) },
        });
    }
    if (wanted.length > 0) {
      const backlogs = steps.backlogs();
      const name = currentBacklog(backlogs.map((file) => file.name));
      const backlog = backlogs.find((file) => file.name === name);
      if (backlog === undefined) throw new Error('No docs/04-tasks-phase-<N>.md to add a row to.');
      // Ids in the docs, on any finding, and given out by a run whose write-back is still owed.
      let next =
        highestTaskId([
          ...backlogs.map((file) => file.text),
          ...steps.findingTasks(),
          ...kept.map((request) => request.task ?? ''),
        ]) + 1;
      const rows: string[] = [];
      for (const { request, source } of wanted) {
        const task = `T-${next}`;
        next += 1;
        rows.push(taskRow(task, request.finding, source, steps.guard));
        result.made.push({ finding: request.finding, task });
      }
      // When this throws nothing was claimed: the caller keeps the state it had.
      const address = steps.pullRequest(backlog.name, addRows(backlog.text, rows), result.made);
      result.pullRequest = address;
      wanted.forEach(({ request }, i) =>
        kept.push({ ...request, task: result.made[i]!.task, pull_request: address }),
      );
    }
    // The id goes back onto the finding: one more line, the same id.
    const left: Pending[] = [];
    for (const request of kept) {
      const task = request.task!;
      const already = text(steps.history(request.finding).at(-1)?.task) === task;
      const written = already
        ? ({ ok: true } as const)
        : steps.seen(
            writeBackArgs(request, task),
            `Task row ${task} added to the backlog for this finding${
              request.pull_request === undefined ? '' : ` (${request.pull_request})`
            }, asked by console command ${request.command}. No work on it has started.`,
          );
      if (written.ok) continue;
      result.failures.push(
        `${request.finding}: ${task} is in the pull request but was not written on the finding: ${written.reason}`,
      );
      left.push(request);
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
  pullRequest(name: string, content: string, made: readonly MadeRow[]): string;
  close(): void;
}

/**
 * A fresh checkout of `origin/main` beside the working one (`git worktree`),
 * so the maintainer's own checkout, whatever branch and changes it holds, is
 * not touched. The branch is `docs-task-rows-<date>-t-<first id>`; the commit
 * holds the backlog file alone. `open` opens the pull request (GitHub's `gh`
 * by default) and answers its address.
 */
export function checkout(
  root: string,
  options: {
    exec?: Run;
    now?: Date;
    /** Opens the pull request for the pushed branch; the default runs `gh pr create`. */
    open?: (branch: string, title: string, body: string, cwd: string) => string;
  } = {},
): Checkout {
  const exec = options.exec ?? run;
  const day = (options.now ?? new Date()).toISOString().slice(0, 10);
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
  const worktree = (): string => {
    if (tree !== null) return tree;
    exec('git', ['fetch', '--quiet', 'origin', 'main'], root);
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
    pullRequest: (name, content, made) => {
      const cwd = worktree();
      const ids = made.map((row) => row.task);
      const branch = `docs-task-rows-${day}-${ids[0]!.toLowerCase()}`;
      const title = `docs: task row${ids.length === 1 ? '' : 's'} ${ids.join(', ')} for accepted findings`;
      const body = [
        'Rows added by the `task-row` step of the console publisher (T-1907, D-456 point 2): each',
        'finding below was accepted on the agents console. A row is a stub; no work on it has started.',
        '',
        ...made.map((row) => `- ${row.task}: finding \`${row.finding}\``),
        '',
      ].join('\n');
      exec('git', ['switch', '--quiet', '-c', branch], cwd);
      writeFileSync(join(cwd, 'docs', name), content);
      exec('git', ['add', '--', `docs/${name}`], cwd);
      exec('git', ['commit', '--quiet', '-m', title], cwd);
      exec('git', ['push', '--quiet', '-u', 'origin', branch], cwd);
      return open(branch, title, body, cwd);
    },
    close: () => {
      if (tree === null) return;
      const folder = tree;
      tree = null;
      try {
        exec('git', ['worktree', 'remove', '--force', folder], root);
      } catch {
        rmSync(folder, { recursive: true, force: true });
        try {
          exec('git', ['worktree', 'prune'], root);
        } catch {
          // The next `git worktree prune` clears it.
        }
      }
    },
  };
}
