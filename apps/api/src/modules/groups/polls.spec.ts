import { describe, expect, it } from 'vitest';
import {
  type PollRecord,
  isOpen,
  pollView,
  validatePoll,
  validateRemovalReason,
} from './internal/polls';

/** Group polls' pure half (T-643, D-091): the shape of a valid poll and what a viewer sees. */

const record = (over: Partial<PollRecord> = {}): PollRecord => ({
  id: 'p1',
  question: 'Who wins the derby?',
  creatorId: 'creator',
  creatorUsername: 'ada',
  createdAt: '2026-09-28T10:00:00.000Z',
  closesAt: '2026-10-05T10:00:00.000Z',
  closedAt: null,
  now: '2026-09-29T10:00:00.000Z',
  myVote: null,
  options: [
    { id: 'o1', label: 'Home', votes: 3 },
    { id: 'o2', label: 'Away', votes: 1 },
  ],
  ...over,
});

describe('validatePoll', () => {
  it('takes a question, two to six options and a window, trimming and dropping blank rows', () => {
    expect(
      validatePoll({ question: '  Who wins?  ', options: [' Home ', '', 'Away', '  '] }),
    ).toEqual({ ok: true, poll: { question: 'Who wins?', options: ['Home', 'Away'], hours: 168 } });
    expect(
      validatePoll({ question: 'Q', options: ['a', 'b'], closes_in_hours: 720 }),
    ).toMatchObject({ ok: true, poll: { hours: 720 } });
  });

  it('names every bad field at once', () => {
    const result = validatePoll({
      question: 'x'.repeat(201),
      options: ['only one'],
      closes_in_hours: 721,
    });
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(Object.keys(result.fields).sort()).toEqual(['closes_in_hours', 'options', 'question']);
  });

  it('refuses seven options, an over-long option, the same option twice and a part-hour', () => {
    const fields = (body: Parameters<typeof validatePoll>[0]) => {
      const result = validatePoll(body);
      return result.ok ? {} : result.fields;
    };
    expect(fields({ question: 'Q', options: ['1', '2', '3', '4', '5', '6', '7'] })).toHaveProperty(
      'options',
    );
    expect(fields({ question: 'Q', options: ['a', 'b'.repeat(81)] })).toHaveProperty('options');
    expect(fields({ question: 'Q', options: ['Home', 'home '] })).toHaveProperty('options');
    expect(fields({ question: 'Q', options: ['a', 'b'], closes_in_hours: 1.5 })).toHaveProperty(
      'closes_in_hours',
    );
    expect(fields({ question: 'Q', options: ['a', 'b'], closes_in_hours: 0 })).toHaveProperty(
      'closes_in_hours',
    );
    expect(fields(null)).toHaveProperty('question');
  });
});

describe('validateRemovalReason', () => {
  it('wants a sentence of at most 500 characters', () => {
    expect(validateRemovalReason('  off topic ')).toBe('off topic');
    expect(validateRemovalReason('   ')).toBeNull();
    expect(validateRemovalReason(undefined)).toBeNull();
    expect(validateRemovalReason('x'.repeat(501))).toBeNull();
  });
});

describe('pollView', () => {
  const member = { id: 'someone', role: 'member' };

  it('hides the counts from a member who has not voted on an open poll', () => {
    const view = pollView(record(), member);
    expect(view.status).toBe('open');
    expect(view.options.map((o) => o.votes)).toEqual([null, null]);
    expect(view.total_votes).toBeNull();
  });

  it('shows the counts once the member has voted, or once the poll is closed', () => {
    const voted = pollView(record({ myVote: 'o2' }), member);
    expect(voted.options.map((o) => o.votes)).toEqual([3, 1]);
    expect(voted.total_votes).toBe(4);
    expect(voted.my_vote).toBe('o2');

    const early = pollView(record({ closedAt: '2026-09-29T09:00:00.000Z' }), member);
    expect(early.status).toBe('closed');
    expect(early.total_votes).toBe(4);

    const timedOut = pollView(record({ now: '2026-10-05T10:00:00.000Z' }), member);
    expect(timedOut.status).toBe('closed');
    expect(timedOut.options.map((o) => o.votes)).toEqual([3, 1]);
  });

  it('lets the creator or the owner close an open poll, and the owner or a moderator remove one', () => {
    expect(pollView(record(), { id: 'creator', role: 'member' })).toMatchObject({
      may_close: true,
      may_remove: false,
    });
    expect(pollView(record(), { id: 'x', role: 'owner' })).toMatchObject({
      may_close: true,
      may_remove: true,
    });
    expect(pollView(record(), { id: 'x', role: 'moderator' })).toMatchObject({
      may_close: false,
      may_remove: true,
    });
    expect(pollView(record(), member)).toMatchObject({ may_close: false, may_remove: false });
    expect(
      pollView(record({ closedAt: '2026-09-29T09:00:00.000Z' }), { id: 'creator', role: 'owner' })
        .may_close,
    ).toBe(false);
  });

  it('never says who voted: the shape has counts and the viewer’s own choice only', () => {
    const view = pollView(record({ myVote: 'o1' }), member);
    expect(Object.keys(view).sort()).toEqual([
      'closed_at',
      'closes_at',
      'created_at',
      'created_by',
      'id',
      'may_close',
      'may_remove',
      'my_vote',
      'options',
      'question',
      'status',
      'total_votes',
    ]);
    for (const option of view.options)
      expect(Object.keys(option).sort()).toEqual(['id', 'label', 'votes']);
  });

  it('is open strictly before its closing time, by the database clock it was read with', () => {
    expect(
      isOpen({
        closedAt: null,
        closesAt: '2026-10-01T00:00:00.000Z',
        now: '2026-09-30T23:59:59.999Z',
      }),
    ).toBe(true);
    expect(
      isOpen({
        closedAt: null,
        closesAt: '2026-10-01T00:00:00.000Z',
        now: '2026-10-01T00:00:00.000Z',
      }),
    ).toBe(false);
  });
});
