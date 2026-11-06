import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  ConsoleChatItem,
  ConsoleCommand,
  ConsoleMemoryEntry,
  ConsoleRequestList,
  ConsoleSnapshot,
} from '@fmip/contracts';
import { type ChatInbox, dropFromInbox, emptyInbox, mergeInbox, parseReplyArgs } from './chat.ts';
import {
  askCommand,
  decodeImage,
  imageCommand,
  imagesToPull,
  listCommand,
  parseAskArgs,
  parsePullArgs,
  parseResultArgs,
  requestsFile,
  resultCommand,
  sha256Of,
  staleImageFiles,
  summary,
} from './requests.ts';
import { flowsOf, parseCharter } from './flow.ts';
import { type LabRead, labFrom } from './lab.ts';
import {
  DEFAULT_SCHEDULES,
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
 * The model lab's ledger (T-1752, D-371): `E:/FMIP/ops/model/ledger.json`,
 * kept by the model scientist, goes into every snapshot as `model_lab` after
 * `lab.ts` has checked it; an entry with a problem is left out and counted,
 * and each problem is printed on standard error with its entry.
 *
 *     node packages/console-publisher/src/publish.ts lab-check
 *
 * prints the problems alone and exits 1 when there is one: run it after
 * every edit of the ledger, before the next sync carries it.
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
 *
 * Teammate requests (T-1728, D-354), run by Claude in the maintainer's own
 * chat (`.claude/skills/teammate-requests/SKILL.md`):
 *
 *     node packages/console-publisher/src/publish.ts requests-pull [--status s]
 *     node packages/console-publisher/src/publish.ts request-result <request-id> in_progress|done|cancelled [--file result.txt] [< result.txt]
 *     node packages/console-publisher/src/publish.ts request-ask <request-id> [--file question.txt] [< question.txt]
 *
 * `requests-pull` writes `E:/FMIP/ops/console/requests.json` and prints a
 * short summary; the other two write the result box or the question for the
 * teammate, the text from `--file` or standard input, never the arguments.
 *
 * Pictures (T-1731, D-357): `requests-pull` also downloads every picture of
 * every open request (and of any marked to run) to
 * `E:/FMIP/ops/console/requests/<request-id>/<position>-<image-id>.webp`,
 * one `request-image` over ssh each, its base64 checked against the list's
 * sha256; a file already there with that sha256 is not fetched again, and a
 * file of a picture since removed is deleted. `requests.json` names each
 * picture's `local_path`, for a Claude session's Read tool.
 */

const ROOT = process.cwd();
const FMIP = process.env.FMIP_HOME ?? 'E:/FMIP';
const OPS = join(FMIP, 'ops');
const STATE_FILE = join(OPS, 'console', 'state.json');
const INBOX_FILE = join(OPS, 'console', 'chat-inbox.json');
const REQUESTS_FILE = join(OPS, 'console', 'requests.json');
const REQUEST_IMAGES_DIR = join(OPS, 'console', 'requests');
const LAB_FILE = join(OPS, 'model', 'ledger.json');
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

/**
 * The model lab's ledger as the file has it (T-1752): none when the file is
 * missing, and then the model page says the ledger was not supplied.
 */
export function readLab(path = LAB_FILE): LabRead {
  if (!existsSync(path)) return { lab: null, problems: [`${path} does not exist.`] };
  let raw: unknown;
  try {
    raw = JSON.parse(read(path));
  } catch (error) {
    return { lab: null, problems: [`${path} is not JSON: ${(error as Error).message}`] };
  }
  return labFrom(raw, statSync(path).mtime.toISOString());
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

  // The schematic's data (T-1725, D-352): every agent's file, its skill and the charter.
  const charterPath = join(ROOT, '.claude', 'skills', 'team-charter', 'SKILL.md');
  const charter = parseCharter(
    existsSync(charterPath) ? read(charterPath) : '',
    agentFiles.map((file) => file.name),
  );
  const flows = flowsOf(
    agentFiles.map((file) => {
      const skills = skillsOf(file.body, skillNames);
      const primary = skills[0];
      return {
        file,
        skills,
        skillText:
          primary === undefined ? '' : read(join(ROOT, '.claude', 'skills', primary, 'SKILL.md')),
        schedule:
          state.agents[file.name]?.schedule ??
          charter.schedules[file.name] ??
          DEFAULT_SCHEDULES[file.name] ??
          'on-demand',
      };
    }),
    charter,
  );

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
        flow: flows.get(file.name),
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
  const lab = readLab();
  for (const problem of lab.problems) process.stderr.write(`model lab ledger: ${problem}\n`);

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
    model_lab: lab.lab,
  });
}

function ssh(command: string, input?: string): string {
  const result = spawnSync('ssh', [SSH_HOST, command], {
    input,
    encoding: 'utf8',
    timeout: 120_000,
    // A picture is up to ~4 MB as base64, and the request list grows (T-1731).
    maxBuffer: 64 * 1024 * 1024,
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

/** A path as the Read tool takes it on this computer, with forward slashes. */
const forward = (path: string): string => path.replace(/\\/g, '/');

/**
 * The pictures of the pulled requests on this computer (T-1731): fetched
 * unless a file with the same sha256 is there, removed ones deleted. A
 * failed picture is reported and left out; the rest still land.
 */
function pullImages(list: ConsoleRequestList): {
  local: Map<string, string>;
  downloaded: number;
  kept: number;
  failed: string[];
} {
  const local = new Map<string, string>();
  const failed: string[] = [];
  let downloaded = 0;
  let kept = 0;
  const wanted = imagesToPull(list);
  for (const { image, relative } of wanted) {
    const path = join(REQUEST_IMAGES_DIR, relative);
    if (existsSync(path) && sha256Of(readFileSync(path)) === image.sha256) {
      local.set(image.id, forward(path));
      kept += 1;
      continue;
    }
    try {
      const decoded = decodeImage(ssh(imageCommand(CLI, image.id)), image.sha256);
      if (!decoded.ok) throw new Error(decoded.reason);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, decoded.bytes);
      local.set(image.id, forward(path));
      downloaded += 1;
    } catch (error) {
      failed.push(`${image.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  // A picture removed on the console goes from this computer too.
  for (const request of list.requests) {
    const folder = join(REQUEST_IMAGES_DIR, request.id);
    if (!existsSync(folder)) continue;
    const keep = wanted
      .filter((w) => w.requestId === request.id)
      .map((w) => w.relative.slice(request.id.length + 1));
    for (const name of staleImageFiles(readdirSync(folder), keep)) rmSync(join(folder, name));
  }
  return { local, downloaded, kept, failed };
}

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
    case 'lab-check': {
      const lab = readLab();
      for (const problem of lab.problems) process.stderr.write(`${problem}\n`);
      process.stdout.write(
        lab.lab === null
          ? 'No ledger to publish.\n'
          : `${lab.lab.entries.length} entries, ${lab.lab.judgements.length} judgements, ${lab.lab.skipped} left out.\n`,
      );
      return lab.problems.length === 0 ? 0 : 1;
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
        // Persian: the console shows it as written (D-352).
        replyRemote(item.id, 'failed', `عامل ${item.agent} روی رایانه‌ی نگهدارنده نیست.`);
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
    case 'requests-pull': {
      const parsed = parsePullArgs(rest);
      if (!parsed.ok) {
        process.stderr.write(`requests-pull [--status s]: ${parsed.reason}\n`);
        return 2;
      }
      const list = JSON.parse(ssh(listCommand(CLI, parsed.status))) as ConsoleRequestList;
      const images = pullImages(list);
      mkdirSync(dirname(REQUESTS_FILE), { recursive: true });
      writeFileSync(
        REQUESTS_FILE,
        `${JSON.stringify(requestsFile(list, new Date(), images.local), null, 2)}\n`,
      );
      process.stdout.write(
        `${JSON.stringify({
          file: REQUESTS_FILE,
          ...summary(list),
          images: {
            folder: REQUEST_IMAGES_DIR,
            downloaded: images.downloaded,
            kept: images.kept,
            failed: images.failed,
          },
        })}\n`,
      );
      return images.failed.length === 0 ? 0 : 1;
    }
    case 'request-result': {
      const parsed = parseResultArgs(rest);
      if (!parsed.ok) {
        process.stderr.write(
          `request-result <request-id> in_progress|done|cancelled [--file f]: ${parsed.reason}\n`,
        );
        return 2;
      }
      const body = readFileSync(parsed.file ?? 0, 'utf8');
      if (body.trim() === '') {
        process.stderr.write('A result needs its text.\n');
        return 2;
      }
      process.stdout.write(ssh(resultCommand(CLI, parsed.id, parsed.status), body));
      return 0;
    }
    case 'request-ask': {
      const parsed = parseAskArgs(rest);
      if (!parsed.ok) {
        process.stderr.write(`request-ask <request-id> [--file f]: ${parsed.reason}\n`);
        return 2;
      }
      const body = readFileSync(parsed.file ?? 0, 'utf8');
      if (body.trim() === '') {
        process.stderr.write('A question needs its text.\n');
        return 2;
      }
      process.stdout.write(ssh(askCommand(CLI, parsed.id), body));
      return 0;
    }
    default:
      process.stderr.write(
        'build [--out file] | publish | sync | lab-check | finish <id> done|failed "outcome" | chat-pull | chat-reply <id> answered|failed [--file f] | requests-pull [--status s] | request-result <id> in_progress|done|cancelled [--file f] | request-ask <id> [--file f]\n',
      );
      return 2;
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}
