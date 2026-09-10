import { describe, expect, it } from 'vitest';
import { UNIFORM_BRIER, UNIFORM_LOG_LOSS, outcomeOf, score } from './internal/scoring';

const GOLDEN = { home: 0.4637, draw: 0.2622, away: 0.2741 };
const TOP = [{ home: 1, away: 1, probability: 0.1247 }];

describe('outcomeOf', () => {
  it('reads the outcome off the score', () => {
    expect(outcomeOf(2, 1)).toBe('home');
    expect(outcomeOf(2, 2)).toBe('draw');
    expect(outcomeOf(0, 3)).toBe('away');
  });
});

describe('score', () => {
  it('matches metrics.py for a draw the model gave 26.22%', () => {
    const s = score(GOLDEN, TOP, 2, 2);
    expect(s.outcome).toBe('draw');
    expect(s.p_outcome).toBe(0.2622);
    expect(s.log_loss).toBe(1.338648); // -ln 0.2622
    // 0.4637² + (0.2622 − 1)² + 0.2741² = 0.215018 + 0.544349 + 0.075131
    expect(s.brier).toBe(0.834497);
    expect(s.correct).toBe(false);
    expect(s.scoreline_hit).toBe(false);
  });

  it('marks correct and scoreline_hit when the favourite wins by the top scoreline', () => {
    const s = score(GOLDEN, TOP, 1, 1);
    expect(s.correct).toBe(false);
    const home = score(GOLDEN, [{ home: 2, away: 1, probability: 0.09 }], 2, 1);
    expect(home.correct).toBe(true);
    expect(home.scoreline_hit).toBe(true);
    expect(home.p_outcome).toBe(0.4637);
  });

  it('is finite for a probability the model rounded to zero', () => {
    const s = score({ home: 1, draw: 0, away: 0 }, [], 0, 1);
    expect(s.log_loss).toBe(27.631021);
    expect(s.brier).toBe(2);
  });

  it('scores the uniform forecast at the published reference values', () => {
    const s = score({ home: 1 / 3, draw: 1 / 3, away: 1 / 3 }, [], 0, 0);
    expect(s.log_loss).toBe(UNIFORM_LOG_LOSS);
    expect(s.brier).toBe(UNIFORM_BRIER);
    expect(s.p_outcome).toBe(0.3333);
  });
});
