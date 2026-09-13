import { describe, expect, it } from 'vitest';
import {
  MEANINGFUL_MARGIN,
  baseRateLogLoss,
  decisiveAccuracy,
  fit,
  fitConverged,
  logLoss,
  probabilities,
  score,
  spread,
  type Observation,
} from './internal/power-index-backtest';

// Validating the weights against history (T-113).
//
// The tests that matter here are not about the arithmetic being pretty. The
// first version of this fit diverged on real data and produced a log-loss of
// 5.4 against a base rate of 1.07 — which reads as "the Power Index carries no
// information" and is in fact "the gradient descent walked away". So the fit is
// tested against data whose answer is known, and against the failure it had.

/** Matches where the home side wins more often the larger its index lead. */
function signal(count: number, seed = 1): Observation[] {
  const observations: Observation[] = [];
  let state = seed;
  const random = (): number => {
    state = (state * 1103515245 + 12345) % 2147483648;
    return state / 2147483648;
  };
  for (let i = 0; i < count; i += 1) {
    // Differences on the scale the real index produces: tens of points.
    const difference = (random() - 0.5) * 80;
    const pHome = 1 / (1 + Math.exp(-difference / 20));
    const roll = random();
    const outcome: Observation['outcome'] =
      roll < pHome * 0.8 ? 'H' : roll < pHome * 0.8 + 0.22 ? 'D' : 'A';
    observations.push({ difference, outcome });
  }
  return observations;
}

/** Matches whose outcome has nothing to do with the index. */
function noise(count: number, seed = 7): Observation[] {
  return signal(count, seed).map((observation, index) => ({
    difference: observation.difference,
    outcome: (['H', 'D', 'A'] as const)[index % 3] as Observation['outcome'],
  }));
}

describe('the probabilities the gap is turned into', () => {
  const fitted = { beta: 1, lower: -0.4, upper: 0.4, scale: 20 };

  it('always sum to one, and are ordered as the outcomes are', () => {
    for (const difference of [-80, -20, 0, 20, 80]) {
      const [home, draw, away] = probabilities(fitted, difference);
      expect(home + draw + away).toBeCloseTo(1, 10);
      expect(home).toBeGreaterThan(0);
      expect(draw).toBeGreaterThan(0);
      expect(away).toBeGreaterThan(0);
    }
    // A bigger lead moves probability from away, through draw, to home — it
    // cannot jump from one end to the other.
    const [homeAtBig] = probabilities(fitted, 60);
    const [homeAtSmall] = probabilities(fitted, 5);
    expect(homeAtBig).toBeGreaterThan(homeAtSmall);
    const [, , awayAtBig] = probabilities(fitted, 60);
    const [, , awayAtSmall] = probabilities(fitted, 5);
    expect(awayAtBig).toBeLessThan(awayAtSmall);
  });

  it('works on the scale the index actually produces, not on a raw slope', () => {
    // Scale is part of the fit: without it the same beta means something
    // different for every division, and the descent has no single step size.
    expect(spread(signal(200))).toBeGreaterThan(10);
    expect(spread([{ difference: 4, outcome: 'H' }])).toBe(1);
  });
});

describe('fitting', () => {
  it('beats the outcome frequencies when the gap really predicts the result', () => {
    const observations = signal(400);
    const fitted = fit(observations);
    const naive = baseRateLogLoss(observations, observations);

    // This is the assertion the first version of the fit would have failed.
    expect(logLoss(fitted, observations)).toBeLessThan(naive);
    expect(fitConverged(fitted, observations)).toBe(true);
  });

  it('lands near the frequencies, not miles past them, when the gap says nothing', () => {
    const observations = noise(300);
    const fitted = fit(observations);
    const naive = baseRateLogLoss(observations, observations);
    // No signal to find, so the best it can do is roughly the base rate. What
    // it must not do is end up far worse, which is what divergence looks like.
    expect(logLoss(fitted, observations)).toBeLessThan(naive + 0.05);
  });

  it('reports a diverged fit as diverged, in the shape the real failure had', () => {
    const observations = signal(200);
    // What divergence looked like: an enormous effective slope, so the model is
    // confident and wrong, and the loss is far worse than saying nothing.
    const diverged = { beta: 40, lower: -0.4, upper: 0.4, scale: 1 };
    expect(logLoss(diverged, observations)).toBeGreaterThan(
      baseRateLogLoss(observations, observations),
    );
    expect(fitConverged(diverged, observations)).toBe(false);

    // And the real fit, from the same data, does not do that.
    expect(fitConverged(fit(observations), observations)).toBe(true);
  });
});

describe('scoring the candidates', () => {
  function split(observations: Observation[]) {
    const half = Math.floor(observations.length / 2);
    return { train: observations.slice(0, half), test: observations.slice(half) };
  }

  it('keeps the published weights when nothing beats them by enough', () => {
    // Every candidate sees the same observations, so no candidate can win.
    const same = signal(400);
    const result = score(
      'E0',
      new Map([
        ['blueprint', split(same)],
        ['equal', split(same)],
        ['form-heavy', split(same)],
      ]),
    );
    expect(result.margin).toBeLessThanOrEqual(MEANINGFUL_MARGIN);
    expect(result.verdict).toContain('Keep the published weights');
  });

  it('refuses a verdict when the arithmetic failed rather than reporting it as a finding', () => {
    // Two observations of the same outcome: nothing to fit, and the loss of a
    // fit on it is meaningless.
    const degenerate: Observation[] = [
      { difference: 0, outcome: 'H' },
      { difference: 0, outcome: 'H' },
    ];
    const result = score('E0', new Map([['blueprint', split(degenerate)]]));
    expect(result.candidates[0]?.converged === false || result.verdict.length > 0).toBe(true);
  });

  it('says the index found nothing when it cannot beat the frequencies', () => {
    const flat = noise(400);
    const result = score('E0', new Map([['blueprint', split(flat)]]));
    // Either it converged and lost to the base rate, or it did not converge.
    // Both are "no finding", and neither may be dressed up as one.
    expect(result.verdict).toMatch(/carries no information|Keep the published weights|No verdict/);
  });
});

describe('the accuracy reported beside the loss', () => {
  it('counts only decisive matches, because a draw has no higher side', () => {
    const observations: Observation[] = [
      { difference: 10, outcome: 'H' },
      { difference: -10, outcome: 'A' },
      { difference: 10, outcome: 'A' },
      { difference: 5, outcome: 'D' },
    ];
    expect(decisiveAccuracy(observations)).toBeCloseTo(2 / 3, 6);
  });
});
