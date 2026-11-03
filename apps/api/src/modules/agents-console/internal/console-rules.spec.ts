import {
  CONSOLE_MESSAGE_MAX,
  CONSOLE_REPLY_MAX,
  CONSOLE_SNAPSHOT_SCHEMA,
  type ConsoleSnapshot,
} from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { parseConsoleArgs } from '../../../cli/agents-console';
import {
  LOCK_AFTER_FAILURES,
  LOCK_MINUTES,
  TEXT_MAX,
  afterFailure,
  checkCard,
  checkCommand,
  checkMessage,
  checkSnapshot,
  cleanText,
  consoleCookie,
  isConsoleUsername,
  isLocked,
  replyText,
} from './console-rules';

const NOW = new Date('2026-11-01T12:00:00Z');

function snapshot(overrides: Partial<ConsoleSnapshot> = {}): ConsoleSnapshot {
  return {
    schema: CONSOLE_SNAPSHOT_SCHEMA,
    generated_at: '2026-11-01T08:30:00Z',
    agents: [
      {
        name: 'data-auditor',
        description: 'Audits the data',
        model: 'sonnet',
        tools: ['Read', 'Bash'],
        access: [{ area: 'the repository', level: 'read', tools: ['Read'] }],
        skills: ['data-audit'],
        schedule: 'daily',
        paused: false,
        workflow: { inputs: ['the server'], steps: ['check'], outputs: ['findings'] },
        memory: {
          sources: [],
          entries: [
            { path: 'MEMORY.md', updated_at: NOW.toISOString(), text: 'x'.repeat(TEXT_MAX + 50) },
          ],
        },
        runs: [],
      },
    ],
    findings: [
      {
        id: 'sec-1',
        agent: 'security',
        severity: 'major',
        status: 'open',
        title: 'A header',
        opened_at: NOW.toISOString(),
        detail: 'how to exploit it',
        related: null,
      },
      {
        id: 'sec-0',
        agent: 'security',
        severity: 'minor',
        status: 'fixed',
        title: 'Old',
        opened_at: NOW.toISOString(),
        detail: 'fixed detail',
        related: null,
      },
      {
        id: 'dat-1',
        agent: 'data-auditor',
        severity: 'minor',
        status: 'open',
        title: 'A score',
        opened_at: NOW.toISOString(),
        detail: 'the detail',
        related: null,
      },
    ],
    reports: [
      {
        agent: 'security',
        date: '2026-11-01',
        title: 'Security',
        path: 'r.md',
        text: 'secret detail',
      },
      { agent: 'data-auditor', date: '2026-11-01', title: 'Data', path: 'd.md', text: 'fine' },
    ],
    brief: null,
    decisions: [],
    ...overrides,
  };
}

describe('the console session cookie', () => {
  it('is host-only, strict, http-only, and secure in production', () => {
    const cookie = consoleCookie('abc', 3600, true);
    expect(cookie).toBe(
      'fmip_console=abc; Path=/; HttpOnly; SameSite=Strict; Max-Age=3600; Secure',
    );
    expect(cookie).not.toContain('Domain');
    expect(consoleCookie('', 0, false)).toBe(
      'fmip_console=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0',
    );
  });
});

describe('names and locks', () => {
  it('accepts a lower-case name of 3 to 32 characters only', () => {
    expect(isConsoleUsername('mostafa')).toBe(true);
    expect(isConsoleUsername('team.mate_2')).toBe(true);
    expect(isConsoleUsername('Mo')).toBe(false);
    expect(isConsoleUsername('Mostafa')).toBe(false);
    expect(isConsoleUsername('a'.repeat(33))).toBe(false);
    expect(isConsoleUsername(7)).toBe(false);
  });

  it(`locks a name for ${LOCK_MINUTES} minutes at the ${LOCK_AFTER_FAILURES}th wrong password`, () => {
    expect(afterFailure(0, NOW)).toEqual({ failures: 1, lockedUntil: null });
    expect(afterFailure(LOCK_AFTER_FAILURES - 2, NOW).lockedUntil).toBeNull();
    const locked = afterFailure(LOCK_AFTER_FAILURES - 1, NOW);
    expect(locked.failures).toBe(0);
    expect(locked.lockedUntil?.toISOString()).toBe('2026-11-01T12:15:00.000Z');
    expect(isLocked(locked.lockedUntil, NOW)).toBe(true);
    expect(isLocked(locked.lockedUntil, new Date('2026-11-01T12:15:01Z'))).toBe(false);
    expect(isLocked(null, NOW)).toBe(false);
  });
});

describe('the snapshot', () => {
  it('keeps an open security finding to its title and severity, and a security report empty', () => {
    const checked = checkSnapshot(snapshot());
    if (!checked.ok) throw new Error(checked.reason);
    const byId = new Map(checked.snapshot.findings.map((f) => [f.id, f]));
    expect(byId.get('sec-1')).toMatchObject({ title: 'A header', severity: 'major', detail: null });
    expect(byId.get('sec-0')?.detail).toBe('fixed detail');
    expect(byId.get('dat-1')?.detail).toBe('the detail');
    expect(checked.snapshot.reports.find((r) => r.agent === 'security')?.text).toBe('');
    expect(checked.snapshot.reports.find((r) => r.agent === 'data-auditor')?.text).toBe('fine');
  });

  it('cuts a long memory file', () => {
    const checked = checkSnapshot(snapshot());
    if (!checked.ok) throw new Error(checked.reason);
    expect(checked.snapshot.agents[0]!.memory.entries[0]!.text).toHaveLength(TEXT_MAX + 1);
  });

  it('refuses another schema, a missing list, or an agent without tools', () => {
    expect(checkSnapshot({ ...snapshot(), schema: 99 }).ok).toBe(false);
    expect(checkSnapshot({ ...snapshot(), generated_at: 'soon' }).ok).toBe(false);
    expect(checkSnapshot({ ...snapshot(), findings: undefined }).ok).toBe(false);
    expect(checkSnapshot({ ...snapshot(), agents: [{ name: 'x' }] }).ok).toBe(false);
    expect(checkSnapshot([]).ok).toBe(false);
  });
});

describe('commands', () => {
  const agents = ['data-auditor'];
  const decisions = ['d-2026-11-01-01'];

  it('takes a known agent or open decision, with a reason', () => {
    expect(
      checkCommand(
        { kind: 'agent.pause', target: 'data-auditor', reason: 'noisy' },
        agents,
        decisions,
      ),
    ).toMatchObject({ ok: true });
    expect(
      checkCommand(
        {
          kind: 'decision.answer',
          target: 'd-2026-11-01-01',
          payload: { answer: 'a' },
          reason: 'chosen',
        },
        agents,
        decisions,
      ),
    ).toMatchObject({ ok: true, command: { payload: { answer: 'a' } } });
  });

  it('refuses an unknown kind, agent, model, schedule, decision, or no reason', () => {
    expect(
      checkCommand({ kind: 'agent.delete', target: 'data-auditor', reason: 'r' }, agents, decisions)
        .ok,
    ).toBe(false);
    expect(
      checkCommand({ kind: 'agent.run', target: 'nobody', reason: 'r' }, agents, decisions).ok,
    ).toBe(false);
    expect(
      checkCommand(
        { kind: 'agent.model', target: 'data-auditor', payload: { model: 'gpt' }, reason: 'r' },
        agents,
        decisions,
      ).ok,
    ).toBe(false);
    expect(
      checkCommand(
        {
          kind: 'agent.schedule',
          target: 'data-auditor',
          payload: { schedule: 'hourly' },
          reason: 'r',
        },
        agents,
        decisions,
      ).ok,
    ).toBe(false);
    expect(
      checkCommand(
        { kind: 'decision.answer', target: 'd-x', payload: { answer: 'a' }, reason: 'r' },
        agents,
        decisions,
      ).ok,
    ).toBe(false);
    expect(
      checkCommand({ kind: 'agent.run', target: 'data-auditor', reason: ' ' }, agents, decisions)
        .ok,
    ).toBe(false);
  });
});

describe('board cards', () => {
  it('needs a title and a column to create, and checks each field', () => {
    expect(checkCard({ title: 'Do it', column: 'next' }, true)).toMatchObject({ ok: true });
    expect(checkCard({ title: 'Do it' }, true).ok).toBe(false);
    expect(checkCard({ column: 'nowhere' }, false).ok).toBe(false);
    expect(checkCard({ due_on: '1 Nov' }, false).ok).toBe(false);
    expect(checkCard({ position: -1 }, false).ok).toBe(false);
    expect(checkCard({ assignee: null, due_on: null }, false)).toMatchObject({
      ok: true,
      card: { assignee: null, due_on: null },
    });
  });
});

describe('the command line', () => {
  it('reads each command and refuses a wrong one', () => {
    expect(parseConsoleArgs(['invite', '--name', 'Mostafa'])).toEqual({
      kind: 'invite',
      name: 'Mostafa',
    });
    expect(parseConsoleArgs(['load-snapshot'])).toEqual({ kind: 'load-snapshot' });
    expect(parseConsoleArgs(['take-commands'])).toEqual({ kind: 'take-commands' });
    expect(
      parseConsoleArgs([
        'finish-command',
        '--id',
        '00000000-0000-4000-8000-000000000001',
        '--status',
        'done',
        '--outcome',
        'paused',
      ]),
    ).toMatchObject({ kind: 'finish-command', status: 'done' });
    expect(parseConsoleArgs(['import-board', '--as', 'Mostafa'])).toEqual({
      kind: 'import-board',
      as: 'mostafa',
    });
    expect(parseConsoleArgs(['import-board']).kind).toBe('error');
    expect(parseConsoleArgs(['invite']).kind).toBe('error');
    expect(
      parseConsoleArgs(['finish-command', '--id', 'x', '--status', 'done', '--outcome', 'y']).kind,
    ).toBe('error');
    expect(parseConsoleArgs(['drop']).kind).toBe('error');
  });

  it('reads the chat commands, the reply never from the arguments (T-1722)', () => {
    const id = '0f8fad5b-d9cb-469f-a165-70867728950e';
    expect(parseConsoleArgs(['take-messages'])).toEqual({ kind: 'take-messages' });
    expect(parseConsoleArgs(['post-reply', '--message', id, '--status', 'answered'])).toEqual({
      kind: 'post-reply',
      id,
      status: 'answered',
    });
    expect(parseConsoleArgs(['post-reply', '--message', id, '--status', 'failed'])).toMatchObject({
      status: 'failed',
    });
    expect(parseConsoleArgs(['post-reply', '--message', 'x', '--status', 'answered']).kind).toBe(
      'error',
    );
    expect(parseConsoleArgs(['post-reply', '--message', id, '--status', 'done']).kind).toBe(
      'error',
    );
    expect(parseConsoleArgs(['post-reply', '--message', id]).kind).toBe('error');
  });
});

describe('chat messages (T-1722)', () => {
  const agents = ['data-auditor', 'security'];

  it('takes a known agent and one to 4,000 characters, trimmed, line ends made \\n', () => {
    expect(checkMessage('data-auditor', { body: '  Why?\r\nTell me.  ' }, agents)).toEqual({
      ok: true,
      body: 'Why?\nTell me.',
    });
    expect(checkMessage('security', { body: 'x'.repeat(CONSOLE_MESSAGE_MAX) }, agents).ok).toBe(
      true,
    );
    // Characters, not UTF-16 units: a Persian or emoji message is counted as Postgres counts it.
    expect(checkMessage('security', { body: '😀'.repeat(CONSOLE_MESSAGE_MAX) }, agents).ok).toBe(
      true,
    );
  });

  it('refuses an unknown or malformed agent, no text, blank text, or too much', () => {
    expect(checkMessage('nobody', { body: 'hi' }, agents)).toEqual({
      ok: false,
      reason: 'No such agent.',
    });
    expect(checkMessage('../security', { body: 'hi' }, [...agents, '../security']).ok).toBe(false);
    expect(checkMessage('security', {}, agents).ok).toBe(false);
    expect(checkMessage('security', 'hi', agents).ok).toBe(false);
    expect(checkMessage('security', { body: 42 }, agents).ok).toBe(false);
    expect(checkMessage('security', { body: ' \n\t ' }, agents).ok).toBe(false);
    expect(checkMessage('security', { body: '\u0000\u0007' }, agents).ok).toBe(false);
    const long = checkMessage('security', { body: 'x'.repeat(CONSOLE_MESSAGE_MAX + 1) }, agents);
    expect(long).toEqual({ ok: false, reason: 'A message is at most 4000 characters.' });
  });

  it('removes the control characters Postgres cannot hold or that hide text, keeping tabs', () => {
    expect(cleanText('a\u0000b\tc\u001bd\u007fe\rf')).toBe('ab\tcde\nf');
  });

  it('cuts a reply to the longest the console keeps', () => {
    expect(replyText('  fine \r\n')).toBe('fine');
    const cut = replyText('y'.repeat(CONSOLE_REPLY_MAX + 50));
    expect([...cut]).toHaveLength(CONSOLE_REPLY_MAX);
    expect(cut.endsWith('…')).toBe(true);
    expect(replyText('z'.repeat(CONSOLE_REPLY_MAX))).toHaveLength(CONSOLE_REPLY_MAX);
  });
});
