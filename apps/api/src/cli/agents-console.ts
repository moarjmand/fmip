import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { AgentsConsoleModule } from '../modules/agents-console/agents-console.module';
import {
  INVITATION_DAYS,
  MESSAGE_ID,
  SNAPSHOT_MAX_BYTES,
  checkCard,
  checkSnapshot,
  consoleTokenText,
  replyText,
} from '../modules/agents-console/internal/console-rules';
import { PostgresConsoleStore } from '../modules/agents-console/internal/console-store';
import { hashToken, newToken, sessionSecretFromEnv } from '../modules/identity/identity.service';

/**
 * The agents console's server side that has no route (T-1696, T-1697,
 * D-340), from a terminal on the server or over `ssh fmip-prod`:
 *
 *     docker compose exec -T api node dist/cli/agents-console.js invite --name "Mostafa"
 *     ... load-snapshot < snapshot.json
 *     ... take-commands
 *     ... finish-command --id <uuid> --status done|failed --outcome "what happened"
 *     ... import-board --as <username> < cards.json
 *     ... take-messages
 *     ... post-reply --message <uuid> --status answered|failed < reply.txt
 *
 * `invite` prints a one-time link to `$CONSOLE_URL/invite/<token>` (D-341), or
 * `https://$CONSOLE_HOST/invite/<token>` when that is unset,
 * open for three days; only the link holds the token. `load-snapshot` reads
 * the computer's snapshot from standard input, checks it and stores it with
 * an open security finding's detail removed. `take-commands` prints the
 * queued commands as JSON and marks them taken; `finish-command` writes one's
 * outcome back. `import-board` moves the project board's cards from its
 * claude.ai page once (T-1700): a JSON list of cards, each with its old id as
 * `source_ref`, so running it again adds none twice.
 *
 * The chat with the agents (T-1722, D-350): `take-messages` prints the queued
 * messages, each with its conversation, as JSON and marks them answering;
 * `post-reply` stores the agent's reply, read from standard input (never
 * from the arguments, so no shell quoting touches it), or with `failed` why
 * there is none.
 */

export type ConsoleCliArgs =
  | { kind: 'invite'; name: string }
  | { kind: 'load-snapshot' }
  | { kind: 'take-commands' }
  | { kind: 'finish-command'; id: string; status: 'done' | 'failed'; outcome: string }
  | { kind: 'import-board'; as: string }
  | { kind: 'take-messages' }
  | { kind: 'post-reply'; id: string; status: 'answered' | 'failed' }
  | { kind: 'error'; message: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The operator's arguments, or what is wrong with them. Pure, for tests. */
export function parseConsoleArgs(argv: string[]): ConsoleCliArgs {
  const [command, ...rest] = argv;
  const flags = new Map<string, string>();
  for (let i = 0; i < rest.length; i += 2) {
    const flag = rest[i] ?? '';
    const value = rest[i + 1];
    if (!flag.startsWith('--') || value === undefined)
      return { kind: 'error', message: `${flag} needs a value.` };
    flags.set(flag.slice(2), value);
  }
  switch (command) {
    case 'invite': {
      const name = flags.get('name')?.trim() ?? '';
      if (name === '' || name.length > 60)
        return { kind: 'error', message: '--name: who the invitation is for.' };
      return { kind: 'invite', name };
    }
    case 'load-snapshot':
      return { kind: 'load-snapshot' };
    case 'take-commands':
      return { kind: 'take-commands' };
    case 'import-board': {
      const as = flags.get('as')?.trim().toLowerCase() ?? '';
      if (as === '')
        return { kind: 'error', message: '--as: the console account the cards are moved as.' };
      return { kind: 'import-board', as };
    }
    case 'finish-command': {
      const id = flags.get('id') ?? '';
      const status = flags.get('status');
      const outcome = flags.get('outcome')?.trim() ?? '';
      if (!UUID.test(id)) return { kind: 'error', message: '--id: the command id.' };
      if (status !== 'done' && status !== 'failed')
        return { kind: 'error', message: '--status: done or failed.' };
      if (outcome === '') return { kind: 'error', message: '--outcome: what happened.' };
      return { kind: 'finish-command', id, status, outcome };
    }
    case 'take-messages':
      return { kind: 'take-messages' };
    case 'post-reply': {
      const id = flags.get('message') ?? '';
      const status = flags.get('status');
      if (!MESSAGE_ID.test(id)) return { kind: 'error', message: '--message: the message id.' };
      if (status !== 'answered' && status !== 'failed')
        return { kind: 'error', message: '--status: answered or failed.' };
      return { kind: 'post-reply', id, status };
    }
    default:
      return {
        kind: 'error',
        message:
          'invite | load-snapshot | take-commands | finish-command | import-board | take-messages | post-reply',
      };
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > SNAPSHOT_MAX_BYTES)
      throw new Error(`Standard input is over ${SNAPSHOT_MAX_BYTES} bytes.`);
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

@Module({ imports: [DatabaseModule, AgentsConsoleModule] })
class AgentsConsoleCliModule {}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const args = parseConsoleArgs(argv);
  if (args.kind === 'error') {
    console.error(args.message);
    return 2;
  }
  process.env.INGESTION_SCHEDULE = 'off';
  const app = await NestFactory.createApplicationContext(AgentsConsoleCliModule, {
    logger: ['error', 'warn'],
  });
  try {
    const store = app.get(PostgresConsoleStore);
    switch (args.kind) {
      case 'invite': {
        // CONSOLE_URL (D-341) while the console lives under the site's host.
        const url = process.env.CONSOLE_URL?.replace(/\/+$/, '');
        const host = process.env.CONSOLE_HOST;
        const base = url || (host ? `https://${host}` : '');
        if (base === '') {
          console.error('Neither CONSOLE_URL nor CONSOLE_HOST is set; see .env.example.');
          return 1;
        }
        const token = newToken();
        const expires = new Date(Date.now() + INVITATION_DAYS * 86_400_000);
        await store.createInvitation(
          hashToken(consoleTokenText(token), sessionSecretFromEnv()),
          args.name,
          expires,
        );
        process.stdout.write(`${base}/invite/${token}\n(open until ${expires.toISOString()})\n`);
        return 0;
      }
      case 'load-snapshot': {
        let raw: unknown;
        try {
          raw = JSON.parse(await readStdin()) as unknown;
        } catch (error) {
          console.error(
            `Not a snapshot: ${error instanceof Error ? error.message : String(error)}`,
          );
          return 1;
        }
        const checked = checkSnapshot(raw);
        if (!checked.ok) {
          console.error(checked.reason);
          return 1;
        }
        await store.loadSnapshot(checked.snapshot);
        process.stdout.write(
          `snapshot of ${checked.snapshot.generated_at} loaded: ${checked.snapshot.agents.length} agents, ` +
            `${checked.snapshot.findings.length} findings, ${checked.snapshot.reports.length} reports\n`,
        );
        return 0;
      }
      case 'import-board': {
        const user = await store.userByName(args.as);
        if (user === null) {
          console.error(`No console account ${args.as}.`);
          return 1;
        }
        const actor = { id: user.id, username: user.username, display_name: user.display_name };
        const cards = JSON.parse(await readStdin()) as unknown;
        if (!Array.isArray(cards)) {
          console.error('The board is not a JSON list of cards.');
          return 1;
        }
        let added = 0;
        const refused: string[] = [];
        for (const raw of cards as Record<string, unknown>[]) {
          const ref = typeof raw.source_ref === 'string' ? raw.source_ref : '';
          const checked = checkCard({ ...raw, source_ref: undefined }, true);
          if (ref === '' || !checked.ok) {
            refused.push(`${ref || '?'}: ${checked.ok ? 'no source_ref' : checked.reason}`);
            continue;
          }
          if (await store.cardFromSource(ref)) continue;
          await store.createCard(checked.card, actor, ref);
          added += 1;
        }
        process.stdout.write(
          [`${added} card(s) added, ${refused.length} refused`, ...refused].join('\n') + '\n',
        );
        return refused.length === 0 ? 0 : 1;
      }
      case 'take-commands':
        process.stdout.write(`${JSON.stringify(await store.takeCommands())}\n`);
        return 0;
      case 'finish-command':
        if (!(await store.finishCommand(args.id, args.status, args.outcome))) {
          console.error(`No taken command ${args.id}.`);
          return 1;
        }
        return 0;
      case 'take-messages':
        process.stdout.write(`${JSON.stringify(await store.takeMessages())}\n`);
        return 0;
      case 'post-reply': {
        const text = replyText(await readStdin());
        if (args.status === 'answered' && text === '') {
          console.error('An answer needs a reply on standard input.');
          return 1;
        }
        if (!(await store.postReply(args.id, args.status, text))) {
          console.error(`No message ${args.id} is waiting for an answer.`);
          return 1;
        }
        return 0;
      }
    }
  } finally {
    await app.close();
  }
}

if (require.main === module) {
  main().then(
    (code) => process.exit(code),
    (error: unknown) => {
      new Logger('agents-console').error(error instanceof Error ? error.message : String(error));
      process.exit(1);
    },
  );
}
