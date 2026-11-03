import { type ConsoleRequestStatus } from '@fmip/contracts';
import {
  CONSOLE_DECISION_TEXT_MAX,
  CONSOLE_REQUEST_BODY_MAX,
  CONSOLE_REQUEST_QUESTION_MAX,
  CONSOLE_REQUEST_RESULT_MAX,
  CONSOLE_REQUEST_STATUSES,
  CONSOLE_REQUEST_TITLE_MAX,
} from '@fmip/contracts/console';
import { describe, expect, it } from 'vitest';
import { parseConsoleArgs, requestOutcomeText } from '../../../cli/agents-console';
import {
  checkDecision,
  checkExecute,
  checkRequestCreate,
  checkRequestEdit,
  checkStatusAction,
  checkStatusFilter,
  isOpen,
  nextStatus,
  questionText,
  resultText,
} from './request-rules';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';

describe('a new request (T-1728)', () => {
  it('takes a title, details and a priority, normal by default, text cleaned', () => {
    expect(checkRequestCreate({ title: '  Fix the table  ' })).toEqual({
      ok: true,
      value: { title: 'Fix the table', body: '', priority: 'normal' },
    });
    expect(
      checkRequestCreate({ title: 'T', body: 'line one\r\nline two\u0007', priority: 'high' }),
    ).toEqual({ ok: true, value: { title: 'T', body: 'line one\nline two', priority: 'high' } });
  });

  it('refuses no title, a long one, long details and an unknown priority', () => {
    expect(checkRequestCreate({}).ok).toBe(false);
    expect(checkRequestCreate(null).ok).toBe(false);
    expect(checkRequestCreate({ title: '   ' }).ok).toBe(false);
    expect(checkRequestCreate({ title: 'x'.repeat(CONSOLE_REQUEST_TITLE_MAX) }).ok).toBe(true);
    expect(checkRequestCreate({ title: 'x'.repeat(CONSOLE_REQUEST_TITLE_MAX + 1) }).ok).toBe(false);
    expect(
      checkRequestCreate({ title: 't', body: 'x'.repeat(CONSOLE_REQUEST_BODY_MAX + 1) }).ok,
    ).toBe(false);
    expect(checkRequestCreate({ title: 't', priority: 'urgent' }).ok).toBe(false);
    expect(checkRequestCreate({ title: 't', body: 5 }).ok).toBe(false);
  });

  it('counts characters, not code units, so Persian and emoji are not cut short', () => {
    expect(checkRequestCreate({ title: '😀'.repeat(CONSOLE_REQUEST_TITLE_MAX) }).ok).toBe(true);
  });
});

describe('an edit', () => {
  it('takes any of the three fields and refuses nothing to change', () => {
    expect(checkRequestEdit({ priority: 'high' })).toEqual({
      ok: true,
      value: { priority: 'high' },
    });
    expect(checkRequestEdit({ body: '' })).toEqual({ ok: true, value: { body: '' } });
    expect(checkRequestEdit({}).ok).toBe(false);
    expect(checkRequestEdit({ title: '' }).ok).toBe(false);
  });
});

describe('the small bodies', () => {
  it('reads cancel or reopen, and execute true or false', () => {
    expect(checkStatusAction({ action: 'cancel' })).toEqual({ ok: true, value: 'cancel' });
    expect(checkStatusAction({ action: 'done' }).ok).toBe(false);
    expect(checkExecute({ execute: false })).toEqual({ ok: true, value: false });
    expect(checkExecute({ execute: 'yes' }).ok).toBe(false);
  });

  it('reads a status filter, all or one status', () => {
    expect(checkStatusFilter(undefined)).toEqual({ ok: true, value: null });
    expect(checkStatusFilter('all')).toEqual({ ok: true, value: null });
    expect(checkStatusFilter('decided')).toEqual({ ok: true, value: 'decided' });
    expect(checkStatusFilter('open').ok).toBe(false);
  });
});

describe('a decision', () => {
  it('takes agree or disagree with or without text, and another view only with text', () => {
    expect(checkDecision({ choice: 'approve' })).toEqual({
      ok: true,
      value: { choice: 'approve', text: null },
    });
    expect(checkDecision({ choice: 'reject', text: ' Not now ' })).toEqual({
      ok: true,
      value: { choice: 'reject', text: 'Not now' },
    });
    expect(checkDecision({ choice: 'other', text: '   ' }).ok).toBe(false);
    expect(checkDecision({ choice: 'other', text: 'Half of it' }).ok).toBe(true);
    expect(checkDecision({ choice: 'maybe' }).ok).toBe(false);
    expect(
      checkDecision({ choice: 'approve', text: 'x'.repeat(CONSOLE_DECISION_TEXT_MAX + 1) }).ok,
    ).toBe(false);
  });
});

describe("Claude's text from standard input", () => {
  it('is trimmed and cleaned, refused when empty or too long rather than cut', () => {
    expect(resultText('  Done.\r\n')).toEqual({ ok: true, value: 'Done.' });
    expect(resultText(' \n ').ok).toBe(false);
    expect(resultText('x'.repeat(CONSOLE_REQUEST_RESULT_MAX + 1)).ok).toBe(false);
    expect(questionText('x'.repeat(CONSOLE_REQUEST_QUESTION_MAX)).ok).toBe(true);
    expect(questionText('x'.repeat(CONSOLE_REQUEST_QUESTION_MAX + 1)).ok).toBe(false);
  });
});

describe('the transitions', () => {
  const all = CONSOLE_REQUEST_STATUSES;
  const open: ConsoleRequestStatus[] = ['new', 'in_progress', 'waiting_decision', 'decided'];
  const closed: ConsoleRequestStatus[] = ['done', 'cancelled'];

  it('keeps done and cancelled closed, the rest open', () => {
    expect(all.filter(isOpen)).toEqual(open);
  });

  it('edits and cancels an open request only, and reopens a closed one to new', () => {
    for (const s of open) {
      expect(nextStatus(s, { kind: 'edit' })).toEqual({ ok: true, status: s });
      expect(nextStatus(s, { kind: 'cancel' })).toEqual({ ok: true, status: 'cancelled' });
      expect(nextStatus(s, { kind: 'reopen' }).ok).toBe(false);
    }
    for (const s of closed) {
      expect(nextStatus(s, { kind: 'edit' }).ok).toBe(false);
      expect(nextStatus(s, { kind: 'cancel' }).ok).toBe(false);
      expect(nextStatus(s, { kind: 'reopen' })).toEqual({ ok: true, status: 'new' });
    }
  });

  it('marks to run an open request that is not waiting for a decision; withdraws always', () => {
    for (const s of ['new', 'in_progress', 'decided'] as const)
      expect(nextStatus(s, { kind: 'execute', on: true })).toEqual({ ok: true, status: s });
    for (const s of ['waiting_decision', 'done', 'cancelled'] as const)
      expect(nextStatus(s, { kind: 'execute', on: true }).ok).toBe(false);
    for (const s of all)
      expect(nextStatus(s, { kind: 'execute', on: false })).toEqual({ ok: true, status: s });
  });

  it('decides only a request waiting for a decision, which becomes decided', () => {
    for (const s of all)
      expect(nextStatus(s, { kind: 'decide' })).toEqual(
        s === 'waiting_decision'
          ? { ok: true, status: 'decided' }
          : expect.objectContaining({ ok: false }),
      );
  });

  it("takes Claude's result in any status, and its question on an open request only", () => {
    for (const s of all) {
      expect(nextStatus(s, { kind: 'result', status: 'done' })).toEqual({
        ok: true,
        status: 'done',
      });
      expect(nextStatus(s, { kind: 'ask' }).ok).toBe(isOpen(s));
    }
    expect(nextStatus('decided', { kind: 'ask' })).toEqual({
      ok: true,
      status: 'waiting_decision',
    });
  });
});

describe('the command line (T-1728)', () => {
  it('lists the requests, all or one status', () => {
    expect(parseConsoleArgs(['list-requests'])).toEqual({ kind: 'list-requests', status: null });
    expect(parseConsoleArgs(['list-requests', '--status', 'waiting_decision'])).toEqual({
      kind: 'list-requests',
      status: 'waiting_decision',
    });
    expect(parseConsoleArgs(['list-requests', '--status', 'open']).kind).toBe('error');
  });

  it('writes a result with a request id and one of three statuses', () => {
    expect(parseConsoleArgs(['request-result', '--id', ID, '--status', 'done'])).toEqual({
      kind: 'request-result',
      id: ID,
      status: 'done',
    });
    expect(parseConsoleArgs(['request-result', '--id', ID, '--status', 'new']).kind).toBe('error');
    expect(
      parseConsoleArgs(['request-result', '--id', 'x; rm -rf /', '--status', 'done']).kind,
    ).toBe('error');
    expect(parseConsoleArgs(['request-result', '--id', ID]).kind).toBe('error');
  });

  it('asks with a request id, the question on standard input', () => {
    expect(parseConsoleArgs(['request-ask', '--id', ID])).toEqual({ kind: 'request-ask', id: ID });
    expect(parseConsoleArgs(['request-ask', '--id', ID.toUpperCase()]).kind).toBe('error');
    expect(parseConsoleArgs(['request-ask']).kind).toBe('error');
  });

  it('says each store outcome, with the exit code', () => {
    expect(requestOutcomeText(ID, { kind: 'missing' })).toEqual({
      code: 1,
      out: `No request ${ID}.\n`,
    });
    expect(requestOutcomeText(ID, { kind: 'refused', reason: 'Closed.' })).toEqual({
      code: 1,
      out: 'Closed.\n',
    });
  });
});
