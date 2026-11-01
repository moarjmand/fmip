import 'reflect-metadata';
import { Logger, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DatabaseModule } from '../database/database.module';
import { AgentsConsoleModule } from '../modules/agents-console/agents-console.module';
import {
  INVITATION_DAYS,
  SNAPSHOT_MAX_BYTES,
  checkSnapshot,
  consoleTokenText,
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
 *
 * `invite` prints a one-time link to `https://$CONSOLE_HOST/invite/<token>`,
 * open for three days; only the link holds the token. `load-snapshot` reads
 * the computer's snapshot from standard input, checks it and stores it with
 * an open security finding's detail removed. `take-commands` prints the
 * queued commands as JSON and marks them taken; `finish-command` writes one's
 * outcome back.
 */

export type ConsoleCliArgs =
  | { kind: 'invite'; name: string }
  | { kind: 'load-snapshot' }
  | { kind: 'take-commands' }
  | { kind: 'finish-command'; id: string; status: 'done' | 'failed'; outcome: string }
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
    default:
      return { kind: 'error', message: 'invite | load-snapshot | take-commands | finish-command' };
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.length;
    if (size > SNAPSHOT_MAX_BYTES)
      throw new Error(`The snapshot is over ${SNAPSHOT_MAX_BYTES} bytes.`);
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
        const host = process.env.CONSOLE_HOST;
        if (host === undefined || host === '') {
          console.error('CONSOLE_HOST is not set; see .env.example.');
          return 1;
        }
        const token = newToken();
        const expires = new Date(Date.now() + INVITATION_DAYS * 86_400_000);
        await store.createInvitation(
          hashToken(consoleTokenText(token), sessionSecretFromEnv()),
          args.name,
          expires,
        );
        process.stdout.write(
          `https://${host}/invite/${token}\n(open until ${expires.toISOString()})\n`,
        );
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
      case 'take-commands':
        process.stdout.write(`${JSON.stringify(await store.takeCommands())}\n`);
        return 0;
      case 'finish-command':
        if (!(await store.finishCommand(args.id, args.status, args.outcome))) {
          console.error(`No taken command ${args.id}.`);
          return 1;
        }
        return 0;
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
