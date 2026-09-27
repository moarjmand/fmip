import { describe, expect, it } from 'vitest';
import {
  type AchievementFacts,
  type AchievementRoundFacts,
  type AchievementSettlement,
  deriveAchievements,
} from './internal/achievements';

const NOW = '2026-09-28T12:00:00.000Z';

/** The n-th settlement, a minute apart, in a fixed order. */
function at(n: number): string {
  return new Date(Date.UTC(2026, 0, 1, 0, n)).toISOString();
}

function settlement(n: number, over: Partial<AchievementSettlement> = {}): AchievementSettlement {
  return {
    settlementId: `s${String(n).padStart(4, '0')}`,
    fixtureId: `f${n}`,
    settledAt: at(n),
    outcomeCorrect: false,
    scoreCorrect: null,
    ...over,
  };
}

function facts(over: Partial<AchievementFacts>): AchievementFacts {
  return { settlements: [], predictions: [], rounds: [], ...over };
}

const kinds = (f: AchievementFacts) => deriveAchievements(f, NOW).earned.map((a) => a.kind);
const earnedAt = (f: AchievementFacts, kind: string) =>
  deriveAchievements(f, NOW).earned.find((a) => a.kind === kind)?.earned_at;

describe('achievements (T-643, D-090)', () => {
  it('earns nothing from nothing, and says which rules and when', () => {
    const result = deriveAchievements(facts({}), NOW);
    expect(result).toEqual({ rules_version: 'achievements@1.0.0', earned: [], computed_at: NOW });
  });

  it('counts settled predictions: the first, the 10th, the 50th and the 100th, each at its settlement', () => {
    const settlements = Array.from({ length: 100 }, (_, i) => settlement(i + 1));
    const f = facts({ settlements: [...settlements].reverse() });
    expect(earnedAt(f, 'first_settled')).toBe(at(1));
    expect(earnedAt(f, 'settled_10')).toBe(at(10));
    expect(earnedAt(f, 'settled_50')).toBe(at(50));
    expect(earnedAt(f, 'settled_100')).toBe(at(100));
    expect(kinds(facts({ settlements: settlements.slice(0, 49) }))).toEqual([
      'first_settled',
      'settled_10',
    ]);
  });

  it('counts exact scores: the first and the fifth, never a settlement without one', () => {
    const settlements = Array.from({ length: 12 }, (_, i) =>
      settlement(i + 1, { scoreCorrect: i % 2 === 1 ? true : i % 4 === 0 ? false : null }),
    );
    const f = facts({ settlements });
    // Exact scores at 2, 4, 6, 8, 10.
    expect(earnedAt(f, 'first_exact_score')).toBe(at(2));
    expect(earnedAt(f, 'exact_scores_5')).toBe(at(10));
    expect(kinds(facts({ settlements: settlements.slice(0, 9) }))).not.toContain('exact_scores_5');
  });

  it('earns a streak at the settlement completing the first run, and a miss starts it again', () => {
    const pattern = [1, 1, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1];
    const settlements = pattern.map((c, i) => settlement(i + 1, { outcomeCorrect: c === 1 }));
    const f = facts({ settlements });
    // Four, a miss, then ten in a row from 6: five at 10, ten at 15.
    expect(earnedAt(f, 'streak_5')).toBe(at(10));
    expect(earnedAt(f, 'streak_10')).toBe(at(15));
    expect(kinds(facts({ settlements: settlements.slice(0, 14) }))).not.toContain('streak_10');
  });

  it('orders by settlement time, then id, whatever order the rows arrive in', () => {
    const tie = at(5);
    const settlements = [
      settlement(2, { settlementId: 'b', settledAt: tie, outcomeCorrect: true }),
      settlement(1, { settlementId: 'a', settledAt: tie, outcomeCorrect: true }),
    ];
    const result = deriveAchievements(facts({ settlements }), NOW);
    expect(result.earned).toEqual([{ kind: 'first_settled', earned_at: tie, round: null }]);
  });

  describe('a full matchday', () => {
    const round = (fixtures: [string, string][], over: Partial<AchievementRoundFacts> = {}) => ({
      competition: { id: 'c1', name: 'Premier League' },
      seasonId: 'se1',
      seasonLabel: '2025/26',
      round: 'Regular Season - 3',
      fixtures: fixtures.map(([fixtureId, status]) => ({ fixtureId, status })),
      ...over,
    });
    const three = [settlement(1), settlement(2), settlement(3)];

    it('is earned at the last settlement of a round the member predicted in full', () => {
      const f = facts({
        settlements: three,
        rounds: [
          round([
            ['f1', 'finished'],
            ['f2', 'finished'],
            ['f3', 'finished'],
          ]),
        ],
      });
      const achievement = deriveAchievements(f, NOW).earned.find((a) => a.kind === 'full_matchday');
      expect(achievement).toEqual({
        kind: 'full_matchday',
        earned_at: at(3),
        round: {
          competition: { id: 'c1', name: 'Premier League' },
          season_label: '2025/26',
          round: 'Regular Season - 3',
        },
      });
    });

    it('is not earned with one match of the round missed', () => {
      const f = facts({
        settlements: three,
        rounds: [
          round([
            ['f1', 'finished'],
            ['f2', 'finished'],
            ['f3', 'finished'],
            ['other', 'finished'],
          ]),
        ],
      });
      expect(kinds(f)).not.toContain('full_matchday');
    });

    it('waits while a match of the round is still to be played', () => {
      for (const status of ['scheduled', 'live', 'suspended']) {
        const f = facts({
          settlements: three,
          rounds: [
            round([
              ['f1', 'finished'],
              ['f2', 'finished'],
              ['f3', 'finished'],
              ['later', status],
            ]),
          ],
        });
        expect(kinds(f), status).not.toContain('full_matchday');
      }
    });

    it('neither requires nor counts a match that settled void', () => {
      const f = facts({
        settlements: three.slice(0, 2),
        rounds: [
          round([
            ['f1', 'finished'],
            ['f2', 'finished'],
            ['gone', 'postponed'],
            ['off', 'cancelled'],
          ]),
        ],
      });
      expect(earnedAt(f, 'full_matchday')).toBe(at(2));
      // One finished match is not a matchday.
      const single = facts({
        settlements: three.slice(0, 1),
        rounds: [
          round([
            ['f1', 'finished'],
            ['gone', 'postponed'],
          ]),
        ],
      });
      expect(kinds(single)).not.toContain('full_matchday');
    });

    it('takes the round completed first when several are complete', () => {
      const f = facts({
        settlements: [settlement(1), settlement(2), settlement(3), settlement(4)],
        rounds: [
          round(
            [
              ['f1', 'finished'],
              ['f4', 'finished'],
            ],
            { round: 'late' },
          ),
          round(
            [
              ['f2', 'finished'],
              ['f3', 'finished'],
            ],
            { round: 'early' },
          ),
        ],
      });
      const achievement = deriveAchievements(f, NOW).earned.find((a) => a.kind === 'full_matchday');
      expect(achievement?.earned_at).toBe(at(3));
      expect(achievement?.round?.round).toBe('early');
    });
  });

  it('earns five competitions at the first prediction in the fifth, settled or not', () => {
    const predictions = [
      { fixtureId: 'a', competitionId: 'c1', firstSubmittedAt: at(1) },
      { fixtureId: 'b', competitionId: 'c1', firstSubmittedAt: at(2) },
      { fixtureId: 'c', competitionId: 'c2', firstSubmittedAt: at(3) },
      { fixtureId: 'd', competitionId: 'c3', firstSubmittedAt: at(4) },
      { fixtureId: 'e', competitionId: 'c4', firstSubmittedAt: at(5) },
      { fixtureId: 'f', competitionId: 'c5', firstSubmittedAt: at(7) },
      { fixtureId: 'g', competitionId: 'c5', firstSubmittedAt: at(6) },
    ];
    expect(earnedAt(facts({ predictions }), 'competitions_5')).toBe(at(6));
    expect(kinds(facts({ predictions: predictions.slice(0, 5) }))).toEqual([]);
  });

  it('lists the earliest first, and ties in the published order', () => {
    const settlements = Array.from({ length: 5 }, (_, i) =>
      settlement(i + 1, { outcomeCorrect: true, scoreCorrect: i === 0 }),
    );
    const result = deriveAchievements(facts({ settlements }), NOW);
    expect(result.earned.map((a) => [a.kind, a.earned_at])).toEqual([
      ['first_settled', at(1)],
      ['first_exact_score', at(1)],
      ['streak_5', at(5)],
    ]);
  });

  it('is the same list from the same rows, however often it is asked', () => {
    const f = facts({ settlements: Array.from({ length: 12 }, (_, i) => settlement(i + 1)) });
    expect(deriveAchievements(f, NOW)).toEqual(deriveAchievements(f, NOW));
  });
});
