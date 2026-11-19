/**
 * The publisher's command lines for the server (T-1878): the pure part.
 *
 * `ssh <host> <command>` hands the command to the remote login shell, which
 * expands it again. So nothing a person, an agent or the console wrote may be
 * part of that line, quoted or not:
 *
 * - every word after the fixed prefix is checked by `remoteCommand` against
 *   `SAFE_WORD` (letters, digits, `_` and `-` only), so no quote, space,
 *   `$`, backtick, `;`, `|`, `&`, `<`, `>` or newline can reach the shell;
 * - an id is checked against its own pattern (a UUID) before that, and a
 *   status against its fixed list;
 * - free text (a command's outcome, a chat reply, a request's result or
 *   question) is never a word: it travels on standard input, byte for byte.
 */

import { MESSAGE_ID } from './chat.ts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** A console command's id (`console_command.id`). */
export const COMMAND_ID = UUID;

/** The only shape a word of a remote command line may have. */
export const SAFE_WORD = /^[A-Za-z0-9_-]+$/;

/** `<user>@<host>` or an ssh config name: never an option (no leading `-`), never a space. */
export const SSH_TARGET = /^(?:[A-Za-z0-9_][A-Za-z0-9._-]*@)?[A-Za-z0-9][A-Za-z0-9._-]*$/;

/** The ssh destination, refused when it could be read as an option or hold shell text. */
export function sshTarget(value: string): string {
  if (!SSH_TARGET.test(value)) throw new Error('FMIP_SSH_HOST is not a host name.');
  return value;
}

/**
 * A command line for the server: the fixed prefix and words that are safe
 * unquoted. Every builder goes through here, so a word that is not plainly a
 * flag, an id or a fixed status stops the call before `ssh` runs.
 */
export function remoteCommand(cli: string, words: readonly string[]): string {
  for (const word of words) {
    if (!SAFE_WORD.test(word)) throw new Error('A remote command word is not safe for a shell.');
  }
  return [cli, ...words].join(' ');
}

/** A command line and what goes on its standard input. */
export interface RemoteCall {
  command: string;
  input: string;
}

export const FINISH_STATUSES = ['done', 'failed'] as const;
export type FinishStatus = (typeof FINISH_STATUSES)[number];
export const REPLY_STATUSES = ['answered', 'failed'] as const;
export type ReplyStatus = (typeof REPLY_STATUSES)[number];

/** `finish-command --id <uuid> --status s`, the outcome on standard input, unchanged. */
export function finishCall(
  cli: string,
  id: string,
  status: FinishStatus,
  outcome: string,
): RemoteCall {
  if (!COMMAND_ID.test(id)) throw new Error('Not a command id.');
  if (!FINISH_STATUSES.includes(status)) throw new Error('Not done or failed.');
  return {
    command: remoteCommand(cli, ['finish-command', '--id', id, '--status', status]),
    input: outcome,
  };
}

/** `post-reply --message <uuid> --status s`, the reply on standard input, unchanged. */
export function replyCall(cli: string, id: string, status: ReplyStatus, body: string): RemoteCall {
  if (!MESSAGE_ID.test(id)) throw new Error('Not a message id.');
  if (!REPLY_STATUSES.includes(status)) throw new Error('Not answered or failed.');
  return {
    command: remoteCommand(cli, ['post-reply', '--message', id, '--status', status]),
    input: body,
  };
}

export type FinishArgs =
  | {
      ok: true;
      id: string;
      status: FinishStatus;
      /** `--file <path>`; `null` reads standard input. */
      file: string | null;
      /**
       * The outcome given as arguments, the form before T-1878, kept for one
       * release: the local shell has already expanded it, so the caller's
       * text may not be what was meant. `null` when `--file` or standard
       * input is used.
       */
      legacyText: string | null;
    }
  | { ok: false; reason: string };

/** `finish <command-id> done|failed [--file outcome.txt]`, or what is wrong with it. */
export function parseFinishArgs(args: readonly string[]): FinishArgs {
  const [id, status, ...rest] = args;
  if (id === undefined || !COMMAND_ID.test(id)) return { ok: false, reason: 'the command id' };
  if (status !== 'done' && status !== 'failed') return { ok: false, reason: 'done or failed' };
  if (rest.length === 0) return { ok: true, id, status, file: null, legacyText: null };
  if (rest[0] === '--file') {
    if (rest[1] === undefined || rest.length !== 2)
      return { ok: false, reason: '--file <path> and nothing after it' };
    return { ok: true, id, status, file: rest[1], legacyText: null };
  }
  return { ok: true, id, status, file: null, legacyText: rest.join(' ') };
}
