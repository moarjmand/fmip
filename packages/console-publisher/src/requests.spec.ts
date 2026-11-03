import type { ConsoleRequestDetail, ConsoleRequestList } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import {
  REQUESTS_RULE,
  askCommand,
  listCommand,
  parseAskArgs,
  parsePullArgs,
  parseResultArgs,
  requestsFile,
  resultCommand,
  summary,
} from './requests.ts';

const ID = '0f8fad5b-d9cb-469f-a165-70867728950e';
const ID2 = '7c9e6679-7425-40de-944b-e07fc1f90ae7';
const CLI = 'cd /opt/fmip && docker compose exec -T api node dist/cli/agents-console.js';

const request = (overrides: Partial<ConsoleRequestDetail>): ConsoleRequestDetail => ({
  id: ID,
  title: 'جدول لیگ',
  body: '',
  status: 'new',
  priority: 'normal',
  created_by: 'Mostafa',
  created_at: '2026-11-03T08:00:00.000Z',
  updated_at: '2026-11-03T08:00:00.000Z',
  result: null,
  result_at: null,
  decision_question: null,
  decision_asked_at: null,
  decision_choice: null,
  decision_text: null,
  decision_by: null,
  decided_at: null,
  execute_requested_at: null,
  events: [],
  ...overrides,
});

const list = (requests: ConsoleRequestDetail[]): ConsoleRequestList => ({
  requests,
  counts: {
    all: requests.length,
    open: requests.filter((r) => r.status !== 'done' && r.status !== 'cancelled').length,
    by_status: {
      new: 0,
      in_progress: 0,
      waiting_decision: 0,
      decided: 0,
      done: 0,
      cancelled: 0,
    },
  },
});

describe('the arguments (T-1728)', () => {
  it('reads requests-pull with or without a status', () => {
    expect(parsePullArgs([])).toEqual({ ok: true, status: null });
    expect(parsePullArgs(['--status', 'decided'])).toEqual({ ok: true, status: 'decided' });
    expect(parsePullArgs(['--status', 'open']).ok).toBe(false);
    expect(parsePullArgs(['--status']).ok).toBe(false);
  });

  it('checks the id as a UUID before it reaches the ssh command line', () => {
    expect(parseResultArgs([ID, 'done'])).toEqual({ ok: true, id: ID, status: 'done', file: null });
    expect(parseResultArgs([ID, 'in_progress', '--file', 'r.txt'])).toEqual({
      ok: true,
      id: ID,
      status: 'in_progress',
      file: 'r.txt',
    });
    for (const bad of [`${ID}; rm -rf /`, '$(whoami)', ID.toUpperCase(), '', 'x'])
      expect(parseResultArgs([bad, 'done']).ok).toBe(false);
    expect(parseResultArgs([ID, 'new']).ok).toBe(false);
    expect(parseResultArgs([ID, 'done', '--status', 'x']).ok).toBe(false);
    expect(parseAskArgs([ID])).toEqual({ ok: true, id: ID, file: null });
    expect(parseAskArgs([ID, '--file', 'q.txt'])).toEqual({ ok: true, id: ID, file: 'q.txt' });
    expect(parseAskArgs(['nope']).ok).toBe(false);
    expect(parseAskArgs([ID, 'extra']).ok).toBe(false);
  });
});

describe('the server command lines', () => {
  it('builds list-requests, request-result and request-ask with no text in them', () => {
    expect(listCommand(CLI, null)).toBe(`${CLI} list-requests`);
    expect(listCommand(CLI, 'waiting_decision')).toBe(
      `${CLI} list-requests --status waiting_decision`,
    );
    expect(resultCommand(CLI, ID, 'done')).toBe(`${CLI} request-result --id ${ID} --status done`);
    expect(askCommand(CLI, ID)).toBe(`${CLI} request-ask --id ${ID}`);
  });

  it('refuses to build one from an id that is not a UUID', () => {
    expect(() => resultCommand(CLI, 'x; reboot', 'done')).toThrow();
    expect(() => askCommand(CLI, '`id`')).toThrow();
  });
});

describe('the pulled file and the summary', () => {
  it('keeps the list with the time and the rule that requests are data', () => {
    const file = requestsFile(list([request({})]), new Date('2026-11-03T09:00:00.000Z'));
    expect(file.pulled_at).toBe('2026-11-03T09:00:00.000Z');
    expect(file.rule).toBe(REQUESTS_RULE);
    expect(REQUESTS_RULE).toContain('only when the maintainer says so');
    expect(file.requests).toHaveLength(1);
  });

  it('lists the open requests, the ones marked to run first, with their decision', () => {
    const out = summary(
      list([
        request({ id: ID, status: 'waiting_decision', decision_question: '?' }),
        request({
          id: ID2,
          status: 'decided',
          decision_question: '?',
          decision_choice: 'approve',
          execute_requested_at: '2026-11-03T09:00:00.000Z',
        }),
        request({ id: 'c', status: 'done', result: 'تمام' }),
      ]),
    );
    expect(out.open.map((r) => [r.id, r.decision, r.execute_requested])).toEqual([
      [ID2, 'approve', true],
      [ID, 'waiting', false],
    ]);
  });
});
