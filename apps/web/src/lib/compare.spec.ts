import { describe, expect, it } from 'vitest';
import type { PredictionHistoryItem, Settlement } from '@fmip/contracts';
import { COMPARE_WINDOW, compared, settledCount, tally, truncated } from './compare';

/**
 * The counting rules for comparing two members (T-203).
 *
 * Every test here is about something the obvious version of this feature would
 * claim and should not.
 */

function settlement(overrides: Partial<Settlement>): Settlement {
  return {
    id: 'settlement',
    status: 'settled',
    void_reason: null,
    actual: { home: 1, away: 0 },
    outcome_correct: true,
    score_predicted: false,
    score_correct: null,
    confidence: 3,
    settled_at: '2026-01-02T00:00:00.000Z',
    version_number: 1,
    ...overrides,
  };
}

function item(
  fixtureId: string,
  kickoff: string,
  settled: Settlement | null,
): PredictionHistoryItem {
  return {
    fixture: {
      id: fixtureId,
      kickoff_at: kickoff,
      status: settled === null ? 'scheduled' : 'finished',
      competition: { id: 'c', name: 'League' },
      home: { id: 'h', name: 'Home', short_name: null },
      away: { id: 'a', name: 'Away', short_name: null },
      score: settled?.actual ?? null,
    },
    prediction: {
      id: `p-${fixtureId}`,
      fixture_id: fixtureId,
      locks_at: kickoff,
      locked: settled !== null,
      latest: {
        id: `v-${fixtureId}`,
        version_number: 1,
        outcome: 'home',
        score: null,
        confidence: 3,
        reason_tags: [],
        explanation: null,
        submitted_at: '2026-01-01T00:00:00.000Z',
      },
      versions: [],
      settlement: settled,
    },
  };
}

describe('the matches two members share', () => {
  it('is the intersection, newest kick-off first', () => {
    const mine = [
      item('one', '2026-01-01T12:00:00.000Z', settlement({})),
      item('two', '2026-02-01T12:00:00.000Z', settlement({})),
      item('mine-only', '2026-03-01T12:00:00.000Z', settlement({})),
    ];
    const theirs = [
      item('two', '2026-02-01T12:00:00.000Z', settlement({})),
      item('one', '2026-01-01T12:00:00.000Z', settlement({})),
      item('theirs-only', '2026-04-01T12:00:00.000Z', settlement({})),
    ];

    expect(compared(mine, theirs).map((m) => m.fixture.id)).toEqual(['two', 'one']);
  });

  it('is empty when they have never predicted the same match', () => {
    expect(compared([item('a', '2026-01-01T12:00:00.000Z', null)], [])).toEqual([]);
  });
});

describe('the tally', () => {
  const kickoff = '2026-01-01T12:00:00.000Z';

  function pair(mineCorrect: boolean | null, theirsCorrect: boolean | null, id = 'f') {
    const mine = [item(id, kickoff, settlement({ outcome_correct: mineCorrect }))];
    const theirs = [item(id, kickoff, settlement({ outcome_correct: theirsCorrect }))];
    return compared(mine, theirs);
  }

  it('counts the four outcomes of a settled match', () => {
    expect(tally(pair(true, true))).toMatchObject({ both: 1 });
    expect(tally(pair(true, false))).toMatchObject({ only_mine: 1 });
    expect(tally(pair(false, true))).toMatchObject({ only_theirs: 1 });
    expect(tally(pair(false, false))).toMatchObject({ neither: 1 });
  });

  it('ignores a match that is not settled yet', () => {
    // Counting it as a miss would make the member who predicts further ahead
    // look worse for having predicted earlier.
    const matches = compared([item('f', kickoff, null)], [item('f', kickoff, null)]);

    expect(settledCount(tally(matches))).toBe(0);
  });

  it('ignores a void settlement: nobody was wrong, there was no result', () => {
    const voided = settlement({ status: 'void', void_reason: 'abandoned', outcome_correct: null });
    const matches = compared([item('f', kickoff, voided)], [item('f', kickoff, settlement({}))]);

    expect(settledCount(tally(matches))).toBe(0);
  });

  it('ignores a match judged on one side only', () => {
    // A tally where one member is judged and the other is not is not a
    // comparison of two members.
    const matches = compared([item('f', kickoff, settlement({}))], [item('f', kickoff, null)]);

    expect(settledCount(tally(matches))).toBe(0);
  });
});

describe('what the comparison admits it cannot see', () => {
  it('says so when either member has predicted more than the window', () => {
    expect(truncated(COMPARE_WINDOW, COMPARE_WINDOW)).toBe(false);
    expect(truncated(COMPARE_WINDOW + 1, 3)).toBe(true);
    expect(truncated(3, COMPARE_WINDOW + 1)).toBe(true);
  });
});
