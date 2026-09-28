import { describe, expect, it } from 'vitest';
import { RATING_FORMULA_V1 } from './internal/formula';
import {
  LEADERBOARD_RULES_V1,
  currentMonth,
  monthBounds,
  parseLeaderboardQuery,
} from './internal/leaderboard';

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
        scope: 'everyone',
        period: { kind: 'all' },
        competition: null,
      },
    });
  });

  it('accepts a filter at or above the floor and a page inside the limits', () => {
    expect(parseLeaderboardQuery({ min_settled: '50', limit: '10', offset: '20' })).toEqual({
      ok: true,
      query: {
        minSettled: 50,
        limit: 10,
        offset: 20,
        scope: 'everyone',
        period: { kind: 'all' },
        competition: null,
      },
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
      query: {
        minSettled: 100,
        limit: LEADERBOARD_RULES_V1.defaultLimit,
        offset: 0,
        scope: 'everyone',
        period: { kind: 'all' },
        competition: null,
      },
    });
  });
});

describe('scope and period (T-641)', () => {
  const query = (raw: Record<string, unknown>) => {
    const parsed = parseLeaderboardQuery(raw);
    return parsed.ok ? parsed.query : parsed.fields;
  };

  it('reads the friends scope and a month or season, with defaults left to the service', () => {
    expect(query({ scope: 'friends' })).toMatchObject({
      scope: 'friends',
      period: { kind: 'all' },
    });
    expect(query({ period: 'month', month: '2026-09' })).toMatchObject({
      period: { kind: 'month', month: '2026-09' },
    });
    expect(query({ period: 'month' })).toMatchObject({ period: { kind: 'month', month: null } });
    expect(query({ period: 'season', season: '2025/26' })).toMatchObject({
      period: { kind: 'season', label: '2025/26' },
    });
    expect(query({ period: 'season' })).toMatchObject({ period: { kind: 'season', label: null } });
  });

  it('keeps the floor on a period board: a short period is not a smaller sample', () => {
    expect(query({ period: 'month', min_settled: '1' })).toEqual({
      min_settled: `Must be at least ${LEADERBOARD_RULES_V1.floor}.`,
    });
  });

  it('names a bad scope, period, month or season, and a picker without its period', () => {
    expect(Object.keys(query({ scope: 'world', period: 'week' })).sort()).toEqual([
      'period',
      'scope',
    ]);
    expect(query({ period: 'month', month: '2026-13' })).toHaveProperty('month');
    expect(query({ period: 'month', month: '26-09' })).toHaveProperty('month');
    expect(query({ period: 'season', season: 'x'.repeat(40) })).toHaveProperty('season');
    expect(query({ month: '2026-09' })).toHaveProperty('month');
    expect(query({ period: 'month', season: '2025/26' })).toHaveProperty('season');
  });

  it('reads a competition id, with any period, and names anything else (T-843)', () => {
    const id = '00000000-0000-4000-8000-0000000002AB';
    expect(query({ competition: id })).toMatchObject({
      competition: id.toLowerCase(),
      period: { kind: 'all' },
    });
    expect(query({ competition: id, period: 'season', season: '2025/26' })).toMatchObject({
      competition: id.toLowerCase(),
      period: { kind: 'season', label: '2025/26' },
    });
    expect(query({ competition: 'premier-league' })).toEqual({
      competition: 'Must be a competition id.',
    });
    // The floor holds per competition exactly as on the whole board (D-037).
    expect(query({ competition: id, min_settled: '1' })).toHaveProperty('min_settled');
  });

  it('bounds a month in UTC, December into January', () => {
    expect(monthBounds('2026-09')).toEqual({
      from: '2026-09-01T00:00:00.000Z',
      to: '2026-10-01T00:00:00.000Z',
    });
    expect(monthBounds('2025-12').to).toBe('2026-01-01T00:00:00.000Z');
    expect(currentMonth(new Date('2026-09-30T23:59:59.999Z'))).toBe('2026-09');
  });
});
