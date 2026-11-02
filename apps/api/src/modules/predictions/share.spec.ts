import { PREDICTION_SHARE_TOKEN } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { cardOf, newShareToken, type ShareableRow } from './internal/share';

/**
 * T-1723 (D-351): a prediction has a "called it" card only when its current
 * settlement is settled with the outcome right, and the card shows the
 * settled version and the score it was settled against.
 */

const row = (over: Partial<ShareableRow> = {}): ShareableRow => ({
  prediction_id: 'p1',
  user_id: 'u1',
  username: 'mosiop',
  account_status: 'active',
  fixture_id: 'f1',
  kickoff_at: new Date('2026-11-01T16:30:00Z'),
  round: 'Regular Season - 9',
  competition: 'Premier League',
  home_name: 'Liverpool',
  home_short_name: null,
  away_name: 'Arsenal',
  away_short_name: null,
  settlement_status: 'settled',
  outcome_correct: true,
  score_correct: null,
  actual_home: 0,
  actual_away: 1,
  outcome: 'away',
  home_goals: null,
  away_goals: null,
  submitted_at: new Date('2026-10-30T17:34:00Z'),
  ...over,
});

describe('the called-it card', () => {
  it('draws the settled version, the settled score and when the pick was made', () => {
    expect(cardOf(row())).toEqual({
      kind: 'called',
      card: {
        fixture_id: 'f1',
        competition: 'Premier League',
        round: 'Regular Season - 9',
        home: { name: 'Liverpool', short_name: null },
        away: { name: 'Arsenal', short_name: null },
        actual: { home: 0, away: 1 },
        pick: { outcome: 'away', score: null },
        exact: false,
        picked_at: '2026-10-30T17:34:00.000Z',
        kickoff_at: '2026-11-01T16:30:00.000Z',
        username: 'mosiop',
      },
    });
  });

  it('says so when the exact score was right too', () => {
    const verdict = cardOf(row({ home_goals: 0, away_goals: 1, score_correct: true }));
    expect(verdict.kind === 'called' && verdict.card).toMatchObject({
      pick: { outcome: 'away', score: { home: 0, away: 1 } },
      exact: true,
    });
  });

  it('has none for an open, a void or a wrong pick', () => {
    expect(cardOf(row({ settlement_status: null }))).toEqual({
      kind: 'not_called',
      reason: 'open',
    });
    expect(cardOf(row({ settlement_status: 'void', outcome_correct: null }))).toEqual({
      kind: 'not_called',
      reason: 'void',
    });
    expect(cardOf(row({ outcome_correct: false }))).toEqual({
      kind: 'not_called',
      reason: 'wrong',
    });
  });
});

describe('a share token', () => {
  it('is 128 random bits in 22 base64url characters, never the same twice', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => newShareToken()));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(PREDICTION_SHARE_TOKEN.test(token)).toBe(true);
  });
});
