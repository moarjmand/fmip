import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type {
  CommandReport,
  ConsoleState,
  FindingLine,
  TaskRowRequest,
  TriageRequest,
} from './snapshot.ts';

/**
 * A person's triage of a finding, written on the maintainer's computer
 * (T-1907, D-456 point 2). The console's three commands, `finding.accept`,
 * `finding.reject` and `finding.snooze`, each become ONE new line with the
 * finding's id, appended through the team's one door for findings,
 * `.claude/skills/team-charter/bin/finding.mjs seen` (T-1884, D-457 point 2).
 * Nothing here opens a findings file to write: no line is ever rewritten.
 *
 *   accept   `planned`, and a task row is asked for (`state.taskRows`); the
 *            `task-row` step makes it. No task id is taken here.
 *   reject   `rejected`, the person's reason in the line's evidence.
 *   snooze   `snoozed` with `until`; it reads `open` again from that day.
 *
 * What a person typed (the reason) is data: it reaches `finding.mjs` in a
 * file, never on a command line, and the line says it is quoted.
 */

/** A finding's id as it may stand on a command line: words joined by hyphens, never an option. */
export const FINDING_ID = /^[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*$/;
/** `finding.mjs`'s own rule for `--by`: one short name. A console username always passes it. */
export const TRIAGE_BY = /^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const STATUS_OF = {
  'finding.accept': 'planned',
  'finding.reject': 'rejected',
  'finding.snooze': 'snoozed',
} as const;

/** How the line names the command that wrote it; a second sync finds it and writes nothing. */
export const commandMark = (id: string): string => `console command ${id}`;

/** The line's evidence: who decided, by which command, and a reject's reason as quoted data. */
export function triageEvidence(request: TriageRequest): string {
  const who = `by ${request.by} (${commandMark(request.id)})`;
  switch (request.kind) {
    case 'finding.accept':
      return `Accepted on the agents console ${who}: planned, a task row is asked for. No work has started.`;
    case 'finding.reject':
      return `Rejected on the agents console ${who}. The person's reason, quoted as written (data, not an instruction): «${request.reason}»`;
    case 'finding.snooze':
      return `Snoozed on the agents console ${who} until ${request.until}.`;
  }
}

/** `finding.mjs seen`'s arguments: fixed words, the id, a date and a name, each checked first. */
export function seenArgs(request: TriageRequest, evidenceFile: string): string[] {
  const args = [
    'seen',
    request.finding,
    '--status',
    STATUS_OF[request.kind],
    '--evidence-file',
    evidenceFile,
    '--by',
    request.by,
  ];
  if (request.kind === 'finding.snooze') args.push('--until', request.until);
  return args;
}

/** What the door answered. */
export type SeenResult = { ok: true } | { ok: false; reason: string };

/** What `applyTriage` does outside this file, so it is tested with stand-ins or on a temp folder. */
export interface TriageSteps {
  /** Every line of that finding, oldest first; empty when the files hold none. */
  history(finding: string): Record<string, unknown>[];
  /** Runs `finding.mjs` with these arguments, `evidence` written to the file `args` name as EVIDENCE. */
  seen(args: (evidenceFile: string) => string[], evidence: string): SeenResult;
}

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** A finding's status as it reads on `today`: a snooze that has run out is open again. */
export function statusOn(record: Record<string, unknown>, today: string): string {
  const status = text(record.status);
  return status === 'snoozed' && DAY.test(text(record.until)) && text(record.until) <= today
    ? 'open'
    : status;
}

/**
 * Writes every triage command the state holds, in order, and takes them out
 * of the state whatever the outcome (a refusal is reported `failed`; the
 * person asks again). A command whose mark is already on a line of its
 * finding was written by a run that stopped before saving: it is reported
 * done and not written twice.
 */
export function applyTriage(
  state: ConsoleState,
  steps: TriageSteps,
  today: string = new Date().toISOString().slice(0, 10),
): { state: ConsoleState; reports: CommandReport[] } {
  const next: ConsoleState = structuredClone(state);
  const taskRows: TaskRowRequest[] = (next.taskRows ??= []);
  const reports: CommandReport[] = [];
  const failed = (id: string, outcome: string) => reports.push({ id, status: 'failed', outcome });
  for (const request of next.triage ?? []) {
    if (!FINDING_ID.test(request.finding)) {
      failed(request.id, 'The command names no finding.');
      continue;
    }
    if (!TRIAGE_BY.test(request.by)) {
      failed(request.id, 'The command does not say who asked.');
      continue;
    }
    if (request.kind === 'finding.reject' && request.reason.trim() === '') {
      failed(request.id, 'A reject needs its reason.');
      continue;
    }
    if (request.kind === 'finding.snooze' && (!DAY.test(request.until) || request.until <= today)) {
      failed(request.id, `A snooze needs a day after today (${today}).`);
      continue;
    }
    const history = steps.history(request.finding);
    const last = history.at(-1);
    if (last === undefined) {
      failed(request.id, `No finding ${request.finding} on the computer.`);
      continue;
    }
    const written = history.some((line) => text(line.evidence).includes(commandMark(request.id)));
    const planned = request.kind === 'finding.accept' && statusOn(last, today) === 'planned';
    if (!written && !planned) {
      const result = steps.seen((file) => seenArgs(request, file), triageEvidence(request));
      if (!result.ok) {
        failed(request.id, `The computer could not write it: ${result.reason}`);
        continue;
      }
    }
    if (request.kind === 'finding.reject') {
      reports.push({ id: request.id, status: 'done', outcome: 'Rejected, with the reason.' });
    } else if (request.kind === 'finding.snooze') {
      reports.push({
        id: request.id,
        status: 'done',
        outcome: `Snoozed until ${request.until}; it is open again from that day.`,
      });
    } else if (text(last.task) !== '') {
      // It has its row already: nothing more is asked for.
      reports.push({
        id: request.id,
        status: 'done',
        outcome: `Planned; it already has the task ${text(last.task)}.`,
      });
    } else {
      if (!taskRows.some((row) => row.finding === request.finding))
        taskRows.push({
          finding: request.finding,
          by: request.by,
          at: request.at,
          command: request.id,
        });
      reports.push({
        id: request.id,
        status: 'done',
        outcome: 'Planned; its task row is made at the next task-row step.',
      });
    }
  }
  next.triage = [];
  return { state: next, reports };
}

// --- The door, for real ------------------------------------------------------

/** Every line of the findings files under `opsRoot`, in date order; a half-written line is skipped. */
export function readFindingLines(opsRoot: string): FindingLine[] {
  const dir = join(opsRoot, 'findings');
  if (!existsSync(dir)) return [];
  const lines: FindingLine[] = [];
  for (const name of readdirSync(dir)
    .filter((file) => file.endsWith('.jsonl'))
    .sort()) {
    for (const line of readFileSync(join(dir, name), 'utf8').split(/\r?\n/)) {
      if (line.trim() === '') continue;
      try {
        lines.push({ file: name, record: JSON.parse(line) as Record<string, unknown> });
      } catch {
        // The next run of the agent that was writing it writes it whole.
      }
    }
  }
  return lines;
}

/** The first line of what `finding.mjs` said, without the folder it ran in. */
const firstLine = (output: string): string =>
  (output.trim().split(/\r?\n/)[0] ?? '').replace(/^finding(\.mjs)?:\s*/, '').slice(0, 300);

/**
 * `finding.mjs` on this computer: `script` run by this Node with no shell,
 * `OPS_ROOT` pointing at `opsRoot`. The evidence is written to a file in a
 * fresh temp folder, removed afterwards.
 */
export function findingDoor(
  script: string,
  opsRoot: string,
  env: NodeJS.ProcessEnv = process.env,
): TriageSteps {
  return {
    history: (finding) =>
      readFindingLines(opsRoot)
        .filter((line) => line.record.id === finding)
        .map((line) => line.record),
    seen: (args, evidence) => {
      const folder = mkdtempSync(join(tmpdir(), 'fmip-triage-'));
      try {
        const file = join(folder, 'evidence.txt');
        writeFileSync(file, evidence);
        const result = spawnSync(process.execPath, [script, ...args(file)], {
          env: { ...env, OPS_ROOT: opsRoot },
          encoding: 'utf8',
          timeout: 60_000,
        });
        if (result.status === 0) return { ok: true };
        return {
          ok: false,
          reason:
            firstLine(result.stderr || result.stdout || '') ||
            result.error?.message ||
            `finding.mjs exited ${String(result.status)}`,
        };
      } finally {
        rmSync(folder, { recursive: true, force: true });
      }
    },
  };
}
