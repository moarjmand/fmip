import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ConsoleRequestStatus } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  SAFE_WORD,
  finishCall,
  parseFinishArgs,
  remoteCommand,
  replyCall,
  sshTarget,
} from './remote.ts';
import { askCommand, imageCommand, listCommand, resultCommand } from './requests.ts';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const CLI = 'cd /opt/fmip && docker compose exec -T api node dist/cli/agents-console.js';

/** Text a shell would act on if it ever saw it: substitutions, quotes, separators, new lines. */
const HOSTILE = [
  'The `security` agent timed out; $(touch x) and `touch y`.',
  'It said "stop" and \'quit\' && touch z | tee w > v; $HOME ${PATH} \\ !',
  'خط دوم با نویسه‌های فارسی',
  '',
  '  last line, spaces kept  ',
].join('\n');

/** The words after the fixed prefix. */
const wordsOf = (command: string): string[] => {
  expect(command.startsWith(`${CLI} `)).toBe(true);
  return command.slice(CLI.length + 1).split(' ');
};

const hasSh = spawnSync('sh', ['-c', 'exit 0']).status === 0;

describe('the command lines for the server (T-1878)', () => {
  it("keeps a command's outcome off the command line and sends it whole on standard input", () => {
    const call = finishCall(CLI, ID, 'failed', HOSTILE);
    expect(call.command).toBe(`${CLI} finish-command --id ${ID} --status failed`);
    expect(call.input).toBe(HOSTILE);
    expect(Buffer.from(call.input, 'utf8').equals(Buffer.from(HOSTILE, 'utf8'))).toBe(true);
    for (const word of wordsOf(call.command)) expect(word).toMatch(SAFE_WORD);
    for (const mark of ['$', '`', '"', "'", ';', '|', '>', '\n', 'touch', 'timed'])
      expect(call.command.slice(CLI.length)).not.toContain(mark);
  });

  it.skipIf(!hasSh)('runs nothing from the outcome when a real shell reads the line', () => {
    // A stand-in for the server's CLI that prints its standard input: `sh -c cat`.
    const dir = mkdtempSync(join(tmpdir(), 'fmip-remote-'));
    try {
      const call = finishCall('sh -c cat stub', ID, 'failed', HOSTILE);
      const ran = spawnSync('sh', ['-c', call.command], { cwd: dir, input: call.input });
      expect(ran.status).toBe(0);
      expect(ran.stdout.equals(Buffer.from(HOSTILE, 'utf8'))).toBe(true);
      // No `touch` ran: the folder is as empty as it was made.
      expect(readdirSync(dir)).toEqual([]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('refuses an id or a status that is not exactly one', () => {
    for (const id of [
      '',
      'x',
      `${ID}; touch x`,
      `${ID} --outcome $(touch x)`,
      `$(touch x)`,
      '`touch x`',
      ID.toUpperCase(),
      `${ID}\n`,
    ]) {
      expect(() => finishCall(CLI, id, 'done', 'ok')).toThrow();
      expect(() => replyCall(CLI, id, 'answered', 'ok')).toThrow();
      expect(() => resultCommand(CLI, id, 'done')).toThrow();
      expect(() => askCommand(CLI, id)).toThrow();
      expect(() => imageCommand(CLI, id)).toThrow();
    }
    expect(() => finishCall(CLI, ID, 'done; touch x' as 'done', 'ok')).toThrow();
    expect(() => replyCall(CLI, ID, 'answered $(touch x)' as 'answered', 'ok')).toThrow();
    expect(() => listCommand(CLI, 'new; touch x' as ConsoleRequestStatus)).toThrow();
    expect(() => listCommand(CLI, '$(touch x)' as ConsoleRequestStatus)).toThrow();
  });

  it('keeps a chat reply off the command line too', () => {
    const call = replyCall(CLI, ID, 'answered', HOSTILE);
    expect(call.command).toBe(`${CLI} post-reply --message ${ID} --status answered`);
    expect(call.input).toBe(HOSTILE);
  });

  it('lets only plain words follow the prefix', () => {
    expect(remoteCommand(CLI, ['take-commands'])).toBe(`${CLI} take-commands`);
    expect(remoteCommand(CLI, ['request-image', '--id', ID, '--thumb'])).toBe(
      `${CLI} request-image --id ${ID} --thumb`,
    );
    for (const word of ['', 'a b', '$(x)', '`x`', '"x"', "'x'", 'a;b', 'a|b', 'a&b', 'a>b', 'a\nb'])
      expect(() => remoteCommand(CLI, ['finish-command', word])).toThrow();
  });

  it('takes an ssh destination that is a name, never an option', () => {
    expect(sshTarget('fmip-prod')).toBe('fmip-prod');
    expect(sshTarget('fmip@203.0.113.7')).toBe('fmip@203.0.113.7');
    for (const value of ['', '-oProxyCommand=x', '-F/tmp/x', 'host name', 'host;x', '$(x)', 'a@-b'])
      expect(() => sshTarget(value)).toThrow();
  });

  it("reads finish's arguments: the id, the status and where the outcome is", () => {
    expect(parseFinishArgs([ID, 'done'])).toEqual({
      ok: true,
      id: ID,
      status: 'done',
      file: null,
      legacyText: null,
    });
    expect(parseFinishArgs([ID, 'failed', '--file', 'outcome.txt'])).toEqual({
      ok: true,
      id: ID,
      status: 'failed',
      file: 'outcome.txt',
      legacyText: null,
    });
    // The form before T-1878, for one release: the words are text, never a command line.
    expect(parseFinishArgs([ID, 'failed', 'timed', 'out'])).toMatchObject({
      ok: true,
      file: null,
      legacyText: 'timed out',
    });
    expect(parseFinishArgs([]).ok).toBe(false);
    expect(parseFinishArgs(['x', 'done']).ok).toBe(false);
    expect(parseFinishArgs([`${ID};x`, 'done']).ok).toBe(false);
    expect(parseFinishArgs([ID, 'paused']).ok).toBe(false);
    expect(parseFinishArgs([ID, 'done', '--file']).ok).toBe(false);
    expect(parseFinishArgs([ID, 'done', '--file', 'a', 'b']).ok).toBe(false);
  });
});
