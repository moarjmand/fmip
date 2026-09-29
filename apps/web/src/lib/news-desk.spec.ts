import type { AuditRecord, BreakingRecord, DebateRecord } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { storyHistory, storyIdFrom } from './news-desk';

const STORY = '00000000-0000-4000-8000-00000000a001';
const OTHER = '00000000-0000-4000-8000-00000000a002';

function debate(overrides: Partial<DebateRecord> = {}): DebateRecord {
  return {
    story_id: STORY,
    headline: 'A headline',
    selected_by: 'editor_a',
    note: 'Two readings of one penalty.',
    selected_at: '2026-09-29T08:00:00.000Z',
    cleared_by: null,
    cleared_reason: null,
    cleared_at: null,
    ...overrides,
  };
}

function mark(overrides: Partial<BreakingRecord> = {}): BreakingRecord {
  return {
    story_id: STORY,
    headline: 'A headline',
    marked_by: 'editor_b',
    note: 'The manager has left.',
    marked_at: '2026-09-29T09:00:00.000Z',
    ends_at: '2026-09-29T15:00:00.000Z',
    cleared_by: null,
    cleared_reason: null,
    cleared_at: null,
    state: 'live',
    ...overrides,
  };
}

function audit(overrides: Partial<AuditRecord> = {}): AuditRecord {
  return {
    id: 'a1',
    actor: { id: 'u1', username: 'editor_c' },
    action: 'story.type',
    target_type: 'story',
    target_id: STORY,
    reason: 'It is a transfer.',
    previous: { label_id: 'l0', type: 'opinion', origin: 'publisher' },
    next: { label_id: 'l1', type: 'transfer', origin: 'editor' },
    created_at: '2026-09-29T10:00:00.000Z',
    ...overrides,
  };
}

describe('storyHistory (T-1009)', () => {
  it('lists every decision about the story, newest first, with who and the words', () => {
    const events = storyHistory(
      STORY,
      [
        debate({
          cleared_by: 'editor_a',
          cleared_reason: 'Settled.',
          cleared_at: '2026-09-29T11:00:00.000Z',
        }),
      ],
      [mark()],
      [audit()],
    );
    expect(events.map((e) => e.kind)).toEqual([
      'debate_cleared',
      'type_labelled',
      'breaking_marked',
      'debate_selected',
    ]);
    expect(events[0]).toMatchObject({ by: 'editor_a', words: 'Settled.' });
    expect(events[1]).toMatchObject({
      by: 'editor_c',
      words: 'It is a transfer.',
      type: { previous: 'opinion', next: 'transfer' },
    });
  });

  it("ignores other stories' decisions and audit rows that are not a story's type", () => {
    const events = storyHistory(
      STORY,
      [debate({ story_id: OTHER })],
      [mark({ story_id: OTHER })],
      [
        audit({ target_id: OTHER }),
        audit({ action: 'debate.select' }),
        audit({ target_type: 'fixture' }),
      ],
    );
    expect(events).toEqual([]);
  });

  it('says when a mark was cleared and when one ran out by itself', () => {
    const cleared = storyHistory(
      STORY,
      [],
      [
        mark({
          state: 'cleared',
          cleared_by: 'editor_d',
          cleared_reason: 'Denied.',
          cleared_at: '2026-09-29T10:00:00.000Z',
        }),
      ],
      null,
    );
    expect(cleared.map((e) => e.kind)).toEqual(['breaking_cleared', 'breaking_marked']);
    const expired = storyHistory(STORY, [], [mark({ state: 'expired' })], null);
    expect(expired[0]).toEqual({
      kind: 'breaking_expired',
      at: '2026-09-29T15:00:00.000Z',
      by: null,
      words: null,
    });
  });

  it('a first type has no previous label, never a default one', () => {
    const [event] = storyHistory(STORY, [], [], [audit({ previous: null })]);
    expect(event?.type).toEqual({ previous: null, next: 'transfer' });
  });
});

describe('storyIdFrom', () => {
  it('reads the id from the id itself or from a story page address', () => {
    expect(storyIdFrom(STORY.toUpperCase())).toBe(STORY);
    expect(storyIdFrom(`https://example.test/en/news/story/${STORY}?language=fa`)).toBe(STORY);
    expect(storyIdFrom('not a story')).toBeNull();
    expect(storyIdFrom(undefined)).toBeNull();
  });
});
