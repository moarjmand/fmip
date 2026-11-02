import { describe, expect, it } from 'vitest';
import { type DisputeIncident, scoreDisputeOf, shownResult } from './internal/score-dispute';

const line = (home: number, away: number) => ({ home, away });
const scores = (
  over: Partial<
    Record<'current' | 'full_time' | 'extra_time' | 'penalties', ReturnType<typeof line>>
  >,
) => ({ current: null, full_time: null, extra_time: null, penalties: null, ...over });
const goal = (
  side: 'home' | 'away' | null,
  minute = 10,
  kind = 'goal',
  in_shootout = false,
): DisputeIncident => ({ kind, side, minute, in_shootout });

describe('scoreDisputeOf (T-1717, D-347)', () => {
  it('is null when the goals add up to the result', () => {
    const s = scores({ current: line(2, 1), full_time: line(2, 1) });
    expect(scoreDisputeOf('finished', s, [goal('home'), goal('away'), goal('home')])).toBeNull();
  });

  it('flags four recorded goals against a 2-0 result (Pafos v Hajduk)', () => {
    // The header read "2–0 · 90′ 4–0": an extra-time line on record, so the
    // page shows `current` (D-317).
    const s = scores({ current: line(2, 0), full_time: line(4, 0), extra_time: line(0, 0) });
    const goals = [goal('home', 5), goal('home', 30), goal('home', 60), goal('home', 88)];
    expect(scoreDisputeOf('finished', s, goals)).toEqual({
      recorded_goals: 4,
      reported: { home: 2, away: 0 },
    });
  });

  it('judges against the ninety minutes when no extra time was played', () => {
    const s = scores({ current: line(4, 0), full_time: line(2, 0) });
    expect(shownResult(s)).toEqual(line(2, 0));
    const goals = [goal('home'), goal('home'), goal('home'), goal('home')];
    expect(scoreDisputeOf('finished', s, goals)?.reported).toEqual(line(2, 0));
  });

  it('judges against the score after extra time when extra time was played', () => {
    const s = scores({ current: line(2, 1), full_time: line(1, 1), extra_time: line(1, 0) });
    const goals = [goal('home', 20), goal('away', 70), goal('home', 110)];
    expect(scoreDisputeOf('finished', s, goals)).toBeNull();
    expect(scoreDisputeOf('finished', s, goals.slice(0, 2))).toEqual({
      recorded_goals: 2,
      reported: line(2, 1),
    });
  });

  it('counts an own goal for the other side, filed either way', () => {
    const s = scores({ full_time: line(1, 1) });
    // Filed under the side credited...
    expect(scoreDisputeOf('finished', s, [goal('home'), goal('away', 50, 'own_goal')])).toBeNull();
    // ...or under the scorer's own side.
    expect(scoreDisputeOf('finished', s, [goal('home'), goal('home', 50, 'own_goal')])).toBeNull();
    // Two goals never make 3-0, however the own goals are read.
    expect(
      scoreDisputeOf('finished', scores({ full_time: line(3, 0) }), [
        goal('away', 10, 'own_goal'),
        goal('home', 20, 'own_goal'),
      ]),
    ).not.toBeNull();
  });

  it('leaves a marked shoot-out kick out of the goals', () => {
    const s = scores({
      current: line(1, 1),
      full_time: line(1, 1),
      extra_time: line(0, 0),
      penalties: line(4, 3),
    });
    const kicks = [1, 2, 3, 4].map(() => goal('home', 120, 'penalty_goal', true));
    expect(scoreDisputeOf('finished', s, [goal('home'), goal('away'), ...kicks])).toBeNull();
  });

  it('reads an unmarked penalty at 120 as a kick only with a shoot-out on record', () => {
    const goals = [goal('home'), goal('away'), goal('home', 120, 'penalty_goal')];
    const withShootout = scores({
      full_time: line(1, 1),
      extra_time: line(0, 0),
      current: line(1, 1),
      penalties: line(5, 4),
    });
    expect(scoreDisputeOf('finished', withShootout, goals)).toBeNull();
    const without = scores({ full_time: line(1, 1), extra_time: line(0, 0), current: line(1, 1) });
    expect(scoreDisputeOf('finished', without, goals)).toEqual({
      recorded_goals: 3,
      reported: line(1, 1),
    });
  });

  it('counts a goal with no side toward the total only', () => {
    const s = scores({ full_time: line(2, 0) });
    expect(scoreDisputeOf('finished', s, [goal('home'), goal(null)])).toBeNull();
    expect(scoreDisputeOf('finished', s, [goal('away'), goal(null)])).not.toBeNull();
  });

  it('claims nothing with no goal recorded, whatever else the timeline holds', () => {
    const s = scores({ full_time: line(2, 0) });
    expect(scoreDisputeOf('finished', s, [])).toBeNull();
    expect(
      scoreDisputeOf('finished', s, [
        { kind: 'yellow_card', side: 'home', minute: 12 },
        goal('home', 80, 'penalty_missed'),
      ]),
    ).toBeNull();
  });

  it('claims nothing for a match not finished or with no result', () => {
    const goals = [goal('home'), goal('home')];
    expect(scoreDisputeOf('live', scores({ current: line(1, 0) }), goals)).toBeNull();
    expect(scoreDisputeOf('finished', scores({}), goals)).toBeNull();
  });
});
