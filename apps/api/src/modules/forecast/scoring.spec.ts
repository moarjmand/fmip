import { describe, expect, it } from 'vitest';
import {
  UNIFORM_BRIER,
  UNIFORM_LOG_LOSS,
  outcomeOf,
  rps,
  score,
  uniformRps,
} from './internal/scoring';

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

describe('rps (T-1369)', () => {
  it('matches the published values of Constantinou and Fenton (2012) for a home win', () => {
    // Their five forecasts of one home win, in the order of their table.
    expect(rps({ home: 1, draw: 0, away: 0 }, 'home')).toBe(0);
    expect(rps({ home: 0.9, draw: 0.1, away: 0 }, 'home')).toBe(0.005);
    expect(rps({ home: 0.8, draw: 0.1, away: 0.1 }, 'home')).toBe(0.025);
    expect(rps({ home: 0.5, draw: 0.25, away: 0.25 }, 'home')).toBe(0.15625);
    expect(rps({ home: 0.35, draw: 0.3, away: 0.35 }, 'home')).toBe(0.2725);
  });

  it('is 1 for all the probability on the wrong end, and 0 for all on the result', () => {
    expect(rps({ home: 1, draw: 0, away: 0 }, 'away')).toBe(1);
    expect(rps({ home: 0, draw: 0, away: 1 }, 'home')).toBe(1);
    expect(rps({ home: 0, draw: 1, away: 0 }, 'draw')).toBe(0);
  });

  it('scores the golden draw', () => {
    // Cumulative (0.4637, 0.7259) against (0, 1): (0.4637² + 0.2741²) / 2.
    expect(rps(GOLDEN, 'draw')).toBe(0.145074);
  });

  it('rewards probability near the result where Brier cannot tell', () => {
    const nearer = { home: 0.2, draw: 0.6, away: 0.2 };
    const further = { home: 0.2, draw: 0.2, away: 0.6 };
    expect(score(nearer, [], 1, 0).brier).toBe(score(further, [], 1, 0).brier);
    expect(rps(nearer, 'home')).toBe(0.34);
    expect(rps(further, 'home')).toBe(0.5);
  });

  it('gives the uniform forecast 5/18 on a decided match and 1/9 on a draw', () => {
    expect(uniformRps('home')).toBe(0.277778);
    expect(uniformRps('away')).toBe(0.277778);
    expect(uniformRps('draw')).toBe(0.111111);
  });
});
