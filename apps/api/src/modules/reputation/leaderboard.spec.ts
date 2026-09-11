import { describe, expect, it } from 'vitest';
import { RATING_FORMULA_V1 } from './internal/formula';
import { LEADERBOARD_RULES_V1, parseLeaderboardQuery } from './internal/leaderboard';

describe('leaderboard rules', () => {
  it('cannot be asked for a board that ranks provisional ratings', () => {
    expect(LEADERBOARD_RULES_V1.floor).toBe(RATING_FORMULA_V1.provisionalBelow);
    for (const preset of LEADERBOARD_RULES_V1.presets)
      expect(preset).toBeGreaterThanOrEqual(LEADERBOARD_RULES_V1.floor);
    expect(LEADERBOARD_RULES_V1.presets).toContain(RATING_FORMULA_V1.establishedAt);
  });
});

describe('parseLeaderboardQuery', () => {
  it('defaults to the floor and the default page', () => {
    expect(parseLeaderboardQuery({})).toEqual({
      ok: true,
      query: {
        minSettled: LEADERBOARD_RULES_V1.floor,
        limit: LEADERBOARD_RULES_V1.defaultLimit,
        offset: 0,
      },
    });
  });

  it('accepts a filter at or above the floor and a page inside the limits', () => {
    expect(parseLeaderboardQuery({ min_settled: '50', limit: '10', offset: '20' })).toEqual({
      ok: true,
      query: { minSettled: 50, limit: 10, offset: 20 },
    });
    expect(parseLeaderboardQuery({ min_settled: String(LEADERBOARD_RULES_V1.floor) }).ok).toBe(
      true,
    );
  });

  it('refuses a filter under the floor instead of raising it quietly', () => {
    const parsed = parseLeaderboardQuery({ min_settled: '1' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.fields.min_settled).toBe(`Must be at least ${LEADERBOARD_RULES_V1.floor}.`);
  });

  it('names every bad field at once', () => {
    const parsed = parseLeaderboardQuery({ min_settled: 'lots', limit: '0', offset: '-1' });
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(Object.keys(parsed.fields).sort()).toEqual(['limit', 'min_settled', 'offset']);
    expect(parseLeaderboardQuery({ limit: '101' }).ok).toBe(false);
  });

  it('takes the first value of a repeated parameter', () => {
    expect(parseLeaderboardQuery({ min_settled: ['100', '1'] })).toEqual({
      ok: true,
      query: { minSettled: 100, limit: LEADERBOARD_RULES_V1.defaultLimit, offset: 0 },
    });
  });
});
