import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ConsoleChatItem,
  ConsoleCommand,
  ConsoleMemoryEntry,
  ConsoleSnapshot,
} from '@fmip/contracts';
import { type ChatInbox, dropFromInbox, emptyInbox, mergeInbox, parseReplyArgs } from './chat.ts';
import {
  type ConsoleState,
  type DeskQuestion,
  type FindingLine,
  type ReportFile,
  agentOf,
  applyCommand,
  deskDecisions,
  emptyState,
  findingsFrom,
  parseAgentFile,
  recordedDecisions,
  reportDirOf,
  reportsFrom,
  skillsOf,
  snapshotOf,
  stepsOf,
} from './snapshot.ts';

/**
 * The agents console's publisher, on the maintainer's computer (T-1699,
 * D-340). From the repository's root:
 *
 *     node packages/console-publisher/src/publish.ts build [--out snapshot.json]
 *     node packages/console-publisher/src/publish.ts publish
 *     node packages/console-publisher/src/publish.ts sync
 *     node packages/console-publisher/src/publish.ts finish <command-id> done|failed "what happened"
 *
 * `build` writes the snapshot; `publish` loads it on the server over
 * `ssh fmip-prod`; `sync` takes the console's queued commands, applies a
 * pause, a model, a schedule or an answer to `E:/FMIP/ops/console/state.json`,
 * reports each back, publishes, and prints the agents a person asked to run,
 * as JSON, for the scheduled task to start; `finish` reports such a run.
 * The server never reaches this computer.
 *
 * The chat (T-1722, D-350), run by the ten-minute scheduled task:
 *
 *     node packages/console-publisher/src/publish.ts chat-pull
 *     node packages/console-publisher/src/publish.ts chat-reply <message-id> answered|failed [--file reply.txt] [< reply.txt]
 *
 * `chat-pull` takes the queued messages over the same `ssh` and keeps them in
 * `E:/FMIP/ops/console/chat-inbox.json`, each with the agent's file and the
 * prompt to start it with (a message to an agent this computer has no file
 * for is answered `failed` at once); `chat-reply` posts the reply, read from
 * `--file` or standard input, never from the arguments, and drops the
 * message from the inbox. The loop is in the package's README.
 */

const ROOT = process.cwd();
const FMIP = process.env.FMIP_HOME ?? 'E:/FMIP';
const OPS = join(FMIP, 'ops');
const STATE_FILE = join(OPS, 'console', 'state.json');
const INBOX_FILE = join(OPS, 'console', 'chat-inbox.json');
const SSH_HOST = process.env.FMIP_SSH_HOST ?? 'fmip-prod';
const CLI = 'cd /opt/fmip && docker compose exec -T api node dist/cli/agents-console.js';

const files = (dir: string, suffix: string): string[] =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith(suffix))
        .sort()
    : [];
const read = (path: string): string => readFileSync(path, 'utf8');
const readJson = <T>(path: string, fallback: T): T => {
  try {
    return JSON.parse(read(path)) as T;
  } catch {
    return fallback;
  }
};

export function loadState(): ConsoleState {
  return { ...emptyState(), ...readJson<Partial<ConsoleState>>(STATE_FILE, {}) };
}

function saveState(state: ConsoleState): void {
  mkdirSync(dirname(STATE_FILE), { recursive: true });
  writeFileSync(STATE_FILE, `${JSON.stringify(state, null, 2)}\n`);
}

function memoryEntries(agent: string): ConsoleMemoryEntry[] {
  const dir = join(ROOT, '.claude', 'agent-memory', agent);
  return files(dir, '.md').map((name) => ({
    path: `.claude/agent-memory/${agent}/${name}`,
    updated_at: statSync(join(dir, name)).mtime.toISOString(),
    text: read(join(dir, name)),
  }));
}

export function buildSnapshot(state: ConsoleState): ConsoleSnapshot {
  const skillNames = existsSync(join(ROOT, '.claude', 'skills'))
    ? readdirSync(join(ROOT, '.claude', 'skills')).sort()
    : [];
  const findingLines: FindingLine[] = [];
  for (const name of files(join(OPS, 'findings'), '.jsonl')) {
    for (const line of read(join(OPS, 'findings', name)).split(/\r?\n/)) {
      if (line.trim() === '') continue;
      try {
        findingLines.push({ file: name, record: JSON.parse(line) as Record<string, unknown> });
      } catch {
        // A half-written line is skipped; the next run writes it whole.
      }
    }
  }
  const agentFiles = files(join(ROOT, '.claude', 'agents'), '.md')
    .map((name) => parseAgentFile(read(join(ROOT, '.claude', 'agents', name))))
    .filter((file) => file !== null);

  const reportFiles: ReportFile[] = [];
  const agents = agentFiles.map((file) => {
    const dir = join(FMIP, reportDirOf(file.name));
    const names = files(dir, '.md');
    for (const name of names)
      reportFiles.push({ agent: file.name, name, text: read(join(dir, name)) });
    const findingDays = new Map<string, number>();
    for (const { file: day, record } of findingLines) {
      if (record.agent === file.name)
        findingDays.set(day.slice(0, 10), (findingDays.get(day.slice(0, 10)) ?? 0) + 1);
    }
    const skills = skillsOf(file.body, skillNames);
    const primary = skills[0];
    const skillText =
      primary === undefined ? '' : read(join(ROOT, '.claude', 'skills', primary, 'SKILL.md'));
    return agentOf(
      {
        file,
        skills,
        steps: stepsOf(skillText || file.body),
        memoryEntries: memoryEntries(file.name),
        findingDays,
        reportDays: names
          .map((name) => name.slice(0, 10))
          .filter((day) => /^\d{4}-\d{2}-\d{2}$/.test(day)),
      },
      state,
    );
  });

  const questions: DeskQuestion[] = [
    ...files(join(OPS, 'desk', 'decisions'), '.json').map((name) => {
      const id = name.replace(/\.json$/, '');
      const question = readJson<Partial<DeskQuestion>>(join(OPS, 'desk', 'decisions', name), {});
      return { ...question, id: question.id ?? id, q: question.q ?? id };
    }),
    ...readJson<DeskQuestion[]>(join(OPS, 'desk-new.json'), []),
  ];
  const deskAnswers: Record<string, { choice: string; at: string }> = {};
  for (const name of files(join(OPS, 'desk', 'answers'), '.json')) {
    Object.assign(deskAnswers, readJson(join(OPS, 'desk', 'answers', name), {}));
  }
  const briefName = files(join(OPS, 'brief'), '.md').at(-1);

  return snapshotOf({
    generated_at: new Date().toISOString(),
    agents,
    findings: findingsFrom(findingLines),
    reports: reportsFrom(reportFiles),
    brief:
      briefName === undefined
        ? null
        : { date: briefName.slice(0, 10), text: read(join(OPS, 'brief', briefName)) },
    decisions: [
      ...deskDecisions(questions, deskAnswers, state),
      ...recordedDecisions(
        existsSync(join(ROOT, 'docs', '00-decisions.md'))
          ? read(join(ROOT, 'docs', '00-decisions.md'))
          : '',
      ),
    ],
  });
}

function ssh(command: string, input?: string): string {
  const result = spawnSync('ssh', [SSH_HOST, command], {
    input,
    encoding: 'utf8',
    timeout: 120_000,
  });
  if (result.status !== 0)
    throw new Error(
      `ssh ${SSH_HOST} failed: ${result.stderr || result.error?.message || result.status}`,
    );
  return result.stdout;
}

const publish = (snapshot: ConsoleSnapshot): string =>
  ssh(`${CLI} load-snapshot`, JSON.stringify(snapshot)).trim();
const finishRemote = (id: string, status: 'done' | 'failed', outcome: string): void => {
  ssh(`${CLI} finish-command --id ${id} --status ${status} --outcome ${JSON.stringify(outcome)}`);
};

const loadInbox = (): ChatInbox => ({
  ...emptyInbox(),
  ...readJson<Partial<ChatInbox>>(INBOX_FILE, {}),
});

function saveInbox(inbox: ChatInbox): void {
  mkdirSync(dirname(INBOX_FILE), { recursive: true });
  writeFileSync(INBOX_FILE, `${JSON.stringify(inbox, null, 2)}\n`);
}

/** Posts a reply; the id is checked against MESSAGE_ID before it reaches the command line. */
const replyRemote = (id: string, status: 'answered' | 'failed', body: string): void => {
  ssh(`${CLI} post-reply --message ${id} --status ${status}`, body);
};

export function main(argv = process.argv.slice(2)): number {
  const [command, ...rest] = argv;
  switch (command) {
    case 'build': {
      const json = JSON.stringify(buildSnapshot(loadState()), null, 2);
      const out = rest[0] === '--out' ? rest[1] : undefined;
      if (out === undefined) process.stdout.write(`${json}\n`);
      else writeFileSync(out, `${json}\n`);
      return 0;
    }
    case 'publish':
      process.stdout.write(`${publish(buildSnapshot(loadState()))}\n`);
      return 0;
    case 'sync': {
      let state = loadState();
      const taken = JSON.parse(ssh(`${CLI} take-commands`) || '[]') as ConsoleCommand[];
      const agents = files(join(ROOT, '.claude', 'agents'), '.md').map((name) =>
        name.replace(/\.md$/, ''),
      );
      for (const cmd of taken) {
        const applied = applyCommand(state, cmd, agents);
        state = applied.state;
        if (applied.finish) finishRemote(cmd.id, applied.status, applied.outcome);
      }
      saveState(state);
      process.stderr.write(`${publish(buildSnapshot(state))}\n`);
      process.stdout.write(`${JSON.stringify(state.runRequests)}\n`);
      return 0;
    }
    case 'finish': {
      const [id, status, ...words] = rest;
      if (id === undefined || (status !== 'done' && status !== 'failed') || words.length === 0) {
        process.stderr.write('finish <command-id> done|failed "what happened"\n');
        return 2;
      }
      const state = loadState();
      state.runRequests = state.runRequests.filter((request) => request.id !== id);
      saveState(state);
      finishRemote(id, status, words.join(' '));
      return 0;
    }
    case 'chat-pull': {
      const taken = JSON.parse(ssh(`${CLI} take-messages`) || '[]') as ConsoleChatItem[];
      let inbox = mergeInbox(loadInbox(), taken, new Date());
      for (const item of inbox.items) {
        if (existsSync(join(ROOT, item.agent_file))) continue;
        replyRemote(item.id, 'failed', `No agent "${item.agent}" on the maintainer's computer.`);
        inbox = dropFromInbox(inbox, item.id, new Date());
      }
      saveInbox(inbox);
      process.stdout.write(
        `${JSON.stringify(inbox.items.map(({ id, agent, agent_file }) => ({ id, agent, agent_file })))}\n`,
      );
      return 0;
    }
    case 'chat-reply': {
      const parsed = parseReplyArgs(rest);
      if (!parsed.ok) {
        process.stderr.write(
          `chat-reply <message-id> answered|failed [--file reply.txt]: ${parsed.reason}\n`,
        );
        return 2;
      }
      const file = rest[2] === '--file' ? rest[3] : undefined;
      const body = readFileSync(file ?? 0, 'utf8');
      if (parsed.status === 'answered' && body.trim() === '') {
        process.stderr.write('An answer needs the reply text.\n');
        return 2;
      }
      try {
        replyRemote(parsed.id, parsed.status, body);
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        // Answered already, or never taken: nothing will take it again, so it leaves the inbox.
        if (text.includes('is waiting for an answer'))
          saveInbox(dropFromInbox(loadInbox(), parsed.id, new Date()));
        throw error;
      }
      saveInbox(dropFromInbox(loadInbox(), parsed.id, new Date()));
      return 0;
    }
    default:
      process.stderr.write(
        'build [--out file] | publish | sync | finish <id> done|failed "outcome" | chat-pull | chat-reply <id> answered|failed [--file f]\n',
      );
      return 2;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
