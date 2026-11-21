import {
  CONSOLE_MESSAGE_MAX,
  CONSOLE_REPLY_MAX,
  CONSOLE_SNAPSHOT_SCHEMA,
  type ConsoleCommand,
  type ConsoleSnapshot,
} from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { accountOutcomeText, parseConsoleArgs } from '../../../cli/agents-console';
import {
  COMMAND_OUTCOME_MAX,
  LOCK_AFTER_FAILURES,
  LOCK_MINUTES,
  COMMAND_VALUES_MAX,
  REASON_MAX,
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
  outcomeText,
  replyText,
  withPendingTriage,
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

  it('holds what a command carries to a few short values (T-1880)', () => {
    const pause = { kind: 'agent.pause', target: 'data-auditor', reason: 'noisy' };
    const carrying = (payload: Record<string, string>) =>
      checkCommand({ ...pause, payload }, agents, decisions);
    expect(carrying({ note: 'x'.repeat(REASON_MAX) }).ok).toBe(true);
    expect(carrying({ note: 'x'.repeat(REASON_MAX + 1) })).toEqual({
      ok: false,
      reason: 'A command carries up to 8 values of 500 characters.',
    });
    const many = (n: number) =>
      Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, 'v']));
    expect(carrying(many(COMMAND_VALUES_MAX)).ok).toBe(true);
    expect(carrying(many(COMMAND_VALUES_MAX + 1)).ok).toBe(false);
    expect(carrying({ ['k'.repeat(41)]: 'v' }).ok).toBe(false);
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
    // T-1836: the console's owner, only from the server's command line, always with a reason.
    expect(
      parseConsoleArgs(['set-owner', '--username', 'Mostafa', '--reason', 'the maintainer']),
    ).toEqual({ kind: 'set-owner', username: 'mostafa', reason: 'the maintainer' });
    expect(parseConsoleArgs(['set-owner', '--username', 'mostafa']).kind).toBe('error');
    expect(parseConsoleArgs(['set-owner', '--reason', 'why']).kind).toBe('error');
    // T-1880: closing an account, always with who runs it and why.
    const whole = ['--name', 'Mate', '--by', ' Mostafa ', '--reason', ' cookie copied '];
    for (const kind of ['disable-user', 'enable-user', 'end-sessions'] as const) {
      expect(parseConsoleArgs([kind, ...whole])).toEqual({
        kind,
        username: 'mate',
        by: 'Mostafa',
        reason: 'cookie copied',
      });
      expect(parseConsoleArgs([kind, '--name', 'mate', '--by', 'Mostafa']).kind).toBe('error');
      expect(parseConsoleArgs([kind, '--name', 'mate', '--reason', 'why']).kind).toBe('error');
      expect(parseConsoleArgs([kind, '--by', 'Mostafa', '--reason', 'why']).kind).toBe('error');
      expect(
        parseConsoleArgs([kind, '--name', 'not a name', '--by', 'Mostafa', '--reason', 'why']).kind,
      ).toBe('error');
    }
    expect(
      parseConsoleArgs(['disable-user', '--username', 'mate', '--by', 'M', '--reason', 'why']),
    ).toMatchObject({ kind: 'disable-user', username: 'mate' });
    expect(parseConsoleArgs(['invite']).kind).toBe('error');
    expect(
      parseConsoleArgs(['finish-command', '--id', 'x', '--status', 'done', '--outcome', 'y']).kind,
    ).toBe('error');
    expect(parseConsoleArgs(['drop']).kind).toBe('error');
  });

  it("reads a command's outcome from standard input, never from the arguments (T-1878)", () => {
    const id = '00000000-0000-4000-8000-000000000001';
    expect(parseConsoleArgs(['finish-command', '--id', id, '--status', 'failed'])).toEqual({
      kind: 'finish-command',
      id,
      status: 'failed',
      outcome: null,
    });
    // The form before, for one release: still read, never empty.
    expect(
      parseConsoleArgs(['finish-command', '--id', id, '--status', 'done', '--outcome', 'paused']),
    ).toEqual({ kind: 'finish-command', id, status: 'done', outcome: 'paused' });
    expect(
      parseConsoleArgs(['finish-command', '--id', id, '--status', 'done', '--outcome', ' ']).kind,
    ).toBe('error');
    expect(parseConsoleArgs(['finish-command', '--id', `${id};x`, '--status', 'done']).kind).toBe(
      'error',
    );
    // What a shell would have acted on is text here, kept as written.
    const hostile = 'The `security` agent timed out; $(touch x)\n"quoted" and \'single\' $HOME';
    expect(outcomeText(`  ${hostile}\r\n`)).toBe(hostile);
    expect(outcomeText(' \n ')).toBe('');
    const cut = outcomeText('y'.repeat(COMMAND_OUTCOME_MAX + 50));
    expect([...cut]).toHaveLength(COMMAND_OUTCOME_MAX);
    expect(cut.endsWith('…')).toBe(true);
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

describe('what the account commands tell the operator (T-1880)', () => {
  const closed = { kind: 'ok' as const, sessions: 2, commands: 1, messages: 3, runMarks: 4 };

  it('counts what disable-user ended and called off', () => {
    expect(accountOutcomeText('disable-user', 'mate', { ...closed, owner: false })).toEqual({
      code: 0,
      out:
        'mate is disabled: it cannot sign in, 2 session(s) ended, 1 queued command(s), ' +
        '3 unanswered message(s) and 4 run mark(s) on teammate requests called off.\n',
    });
  });

  it('warns, without refusing, when the account closed is the owner', () => {
    const { code, out } = accountOutcomeText('disable-user', 'mostafa', { ...closed, owner: true });
    expect(code).toBe(0);
    const [done, warning, ...rest] = out.trimEnd().split('\n');
    expect(done).toMatch(/^mostafa is disabled: /);
    expect(warning).toMatch(/^Warning: mostafa is the console's owner/);
    expect(warning).toContain('no usable owner');
    expect(warning).toContain('enable-user --name mostafa --by <operator> --reason "why"');
    expect(warning).toContain('set-owner --username <name> --reason "why"');
    expect(rest).toEqual([]);
    // Opening it again, or ending its sessions, leaves the owner as it was: nothing to warn of.
    for (const command of ['enable-user', 'end-sessions'] as const) {
      expect(accountOutcomeText(command, 'mostafa', { ...closed, owner: true }).out).not.toContain(
        'Warning',
      );
    }
  });

  it('says so when nothing changed, and when there is no such account', () => {
    expect(accountOutcomeText('disable-user', 'mate', { kind: 'already' })).toEqual({
      code: 0,
      out: 'mate is disabled already. Nothing was changed.\n',
    });
    expect(accountOutcomeText('end-sessions', 'mate', { kind: 'missing' })).toEqual({
      code: 1,
      out: 'No console account mate.\n',
    });
  });
});

describe("a finding's triage (T-1907, D-456 point 2)", () => {
  const findings = ['ops-2026-11-01-01', 'sec-2026-11-01-01'];
  const check = (body: Record<string, unknown>, now = NOW) =>
    checkCommand(body, ['data-auditor'], [], findings, now);

  it('takes an accept, a reject with its reason and a snooze to a later day', () => {
    expect(check({ kind: 'finding.accept', target: findings[0], reason: 'worth doing' })).toEqual({
      ok: true,
      command: {
        kind: 'finding.accept',
        target: findings[0],
        payload: {},
        reason: 'worth doing',
      },
    });
    // The reason travels in the payload: the queue keeps no other copy for the computer.
    expect(
      check({ kind: 'finding.reject', target: findings[0], reason: ' not\r\nours ' }),
    ).toMatchObject({
      ok: true,
      command: { payload: { reason: 'not\nours' }, reason: 'not\nours' },
    });
    const snoozed = check({
      kind: 'finding.snooze',
      target: findings[1],
      payload: { until: '2026-11-02', reason: 'smuggled', note: 'x' },
      reason: 'after the release',
    });
    // Only what the kind takes travels to the computer.
    expect(snoozed).toMatchObject({ ok: true, command: { payload: { until: '2026-11-02' } } });
    expect(snoozed.ok && Object.keys(snoozed.command.payload)).toEqual(['until']);
  });

  it('refuses a reject without a reason of three characters', () => {
    for (const reason of ['ok', ' a ', 'نه']) {
      expect(check({ kind: 'finding.reject', target: findings[0], reason })).toEqual({
        ok: false,
        reason: 'Say why it is rejected, in 3 characters or more.',
      });
    }
    expect(check({ kind: 'finding.reject', target: findings[0], reason: '' }).ok).toBe(false);
    expect(check({ kind: 'finding.reject', target: findings[0] }).ok).toBe(false);
    expect(check({ kind: 'finding.reject', target: findings[0], reason: 'خیر' }).ok).toBe(true);
    // The value keeps D-455's cap of 500 characters.
    expect(
      check({ kind: 'finding.reject', target: findings[0], reason: 'x'.repeat(REASON_MAX + 1) }).ok,
    ).toBe(false);
  });

  it('refuses a snooze to today, into the past, or to a day that does not exist', () => {
    const snooze = (until: unknown, now = NOW) =>
      check(
        { kind: 'finding.snooze', target: findings[0], payload: { until }, reason: 'later' },
        now,
      );
    for (const until of ['2026-11-01', '2026-10-31', '2026-02-30', '2026-13-01', 'tomorrow', '']) {
      expect(snooze(until)).toEqual({
        ok: false,
        reason: 'Snooze until a day after today, YYYY-MM-DD.',
      });
    }
    expect(check({ kind: 'finding.snooze', target: findings[0], reason: 'later' }).ok).toBe(false);
    expect(snooze('2026-11-02').ok).toBe(true);
    // The day is the server's UTC day: a minute before midnight, tomorrow is still tomorrow.
    expect(snooze('2026-11-02', new Date('2026-11-01T23:59:00Z')).ok).toBe(true);
    expect(snooze('2026-11-02', new Date('2026-11-02T00:00:00Z')).ok).toBe(false);
  });

  it('refuses a finding the loaded snapshot does not hold', () => {
    for (const kind of ['finding.accept', 'finding.reject', 'finding.snooze']) {
      expect(
        check({
          kind,
          target: 'ops-2026-11-01-99',
          payload: { until: '2026-12-01' },
          reason: 'why',
        }),
      ).toEqual({ ok: false, reason: 'No such finding.' });
    }
    // An agent's name is not a finding, and with no snapshot there is none.
    expect(check({ kind: 'finding.accept', target: 'data-auditor', reason: 'why' }).ok).toBe(false);
    expect(
      checkCommand({ kind: 'finding.accept', target: findings[0], reason: 'why' }, [], []).ok,
    ).toBe(false);
  });

  const queued = (over: Partial<ConsoleCommand>): ConsoleCommand => ({
    id: 'c-1',
    kind: 'finding.snooze',
    target: 'sec-1',
    payload: { until: '2026-12-01' },
    status: 'queued',
    requested_by: 'Mostafa',
    requested_at: '2026-11-01T10:00:00.000Z',
    finished_at: null,
    outcome: null,
    ...over,
  });

  it('shows each finding with the command not yet applied, and no other', () => {
    const shown = withPendingTriage(snapshot(), [
      queued({}),
      // A newer one wins; a finished one, another kind and another finding are passed over.
      queued({
        id: 'c-2',
        kind: 'finding.accept',
        payload: {},
        status: 'taken',
        requested_at: '2026-11-01T11:00:00.000Z',
      }),
      queued({ id: 'c-3', status: 'done', requested_at: '2026-11-01T12:00:00.000Z' }),
      queued({ id: 'c-4', kind: 'agent.run', requested_at: '2026-11-01T12:00:00.000Z' }),
      queued({ id: 'c-5', target: 'gone' }),
    ]);
    expect(shown.findings.map((f) => [f.id, f.pending?.command_id ?? null])).toEqual([
      ['sec-1', 'c-2'],
      ['sec-0', null],
      ['dat-1', null],
    ]);
    expect(shown.findings[0]?.pending).toEqual({
      command_id: 'c-2',
      kind: 'finding.accept',
      requested_by: 'Mostafa',
      requested_at: '2026-11-01T11:00:00.000Z',
      until: null,
    });
    expect(withPendingTriage(snapshot(), [queued({})]).findings[0]?.pending?.until).toBe(
      '2026-12-01',
    );
  });

  it("keeps a triaged security finding's detail back, and drops a `pending` the computer sent", () => {
    for (const status of ['planned', 'rejected', 'snoozed'] as const) {
      const base = snapshot();
      const checked = checkSnapshot({
        ...base,
        findings: [
          { ...base.findings[0]!, status, detail: 'how to use it', pending: { command_id: 'x' } },
        ],
      });
      if (!checked.ok) throw new Error(checked.reason);
      expect(checked.snapshot.findings[0]).toMatchObject({ status, detail: null });
      expect('pending' in checked.snapshot.findings[0]!).toBe(false);
    }
  });
});
