/**
 * Validating the Power Index weights against history (T-113).
 *
 * The blueprint publishes weights and then says "the calculation should use
 * historical performance to validate or adjust these weights". This is the
 * validation, and it is arranged so that it can only ever produce an honest
 * answer: the weights are compared on matches the fitting never saw, and a
 * candidate has to *beat* the blueprint's numbers to replace them.
 *
 * **What is measured.** The index is not a probability, so it cannot be scored
 * as one directly. Instead the difference between the two sides' indexes is
 * turned into home/draw/away probabilities by an ordered logistic — one slope
 * and two thresholds, fitted on the first half of the season — and the weights
 * are judged by the log-loss of those probabilities on the second half. Log-loss
 * because it punishes confident mistakes, which is exactly what a weight set
 * that overfits its own history produces.
 *
 * Pure: no database, no network. The script in `apps/api/scripts/` supplies the
 * matches and writes the report.
 */

import type { PowerIndexComponent } from '@fmip/contracts';
import { POWER_INDEX_WEIGHTS } from '@fmip/contracts';

export type Outcome = 'H' | 'D' | 'A';

/** One backtested match: the index gap, and what actually happened. */
export interface Observation {
  difference: number;
  outcome: Outcome;
}

/**
 * Slope and the two thresholds that separate away, draw and home, plus the
 * scale the differences were standardised by.
 *
 * The scale is part of the fit, not a detail of it. An index difference runs to
 * several tens of points, and a gradient on that raw scale is tens of times
 * larger than the one on the thresholds, so the same step size cannot serve
 * both: the first version of this fit diverged silently and reported a log-loss
 * of 5.4 against a base rate of 1.07 — a number that looks like a finding and is
 * an arithmetic failure. Standardising removes the problem at the source, and
 * `fitConverged` below refuses to report a fit that still did not work.
 */
export interface OrderedLogistic {
  beta: number;
  lower: number;
  upper: number;
  /** Differences are divided by this before use. Never zero. */
  scale: number;
}

export const INITIAL_FIT: OrderedLogistic = { beta: 0.5, lower: -0.4, upper: 0.4, scale: 1 };
export const FIT_STEPS = 3000;
export const INITIAL_RATE = 0.2;
/** Probabilities are clamped away from 0 and 1 so one surprise cannot dominate. */
export const PROBABILITY_FLOOR = 1e-6;

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function clamp(p: number): number {
  return Math.min(1 - PROBABILITY_FLOOR, Math.max(PROBABILITY_FLOOR, p));
}

/**
 * Home, draw and away probabilities for one index difference.
 *
 * Ordered because the three outcomes are ordered: a bigger gap in the home
 * side's favour should move probability from away through draw to home, and a
 * model that can move it from away to home without passing through draw would
 * be free to produce nonsense that the fit would happily accept.
 */
export function probabilities(fit: OrderedLogistic, difference: number): [number, number, number] {
  const z = (fit.beta * difference) / (fit.scale === 0 ? 1 : fit.scale);
  const belowLower = sigmoid(fit.lower - z);
  const belowUpper = sigmoid(fit.upper - z);
  const away = clamp(belowLower);
  const draw = clamp(belowUpper - belowLower);
  const home = clamp(1 - belowUpper);
  const total = home + draw + away;
  return [home / total, draw / total, away / total];
}

/** Mean negative log probability of what actually happened. Lower is better. */
export function logLoss(fit: OrderedLogistic, observations: Observation[]): number {
  if (observations.length === 0) return Number.NaN;
  let total = 0;
  for (const observation of observations) {
    const [home, draw, away] = probabilities(fit, observation.difference);
    const p = observation.outcome === 'H' ? home : observation.outcome === 'D' ? draw : away;
    total += -Math.log(p);
  }
  return total / observations.length;
}

/** Standard deviation of the differences. The scale the fit works in. */
export function spread(observations: Observation[]): number {
  if (observations.length === 0) return 1;
  const values = observations.map((o) => o.difference);
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance =
    values.reduce((sum, value) => sum + (value - average) ** 2, 0) / Math.max(1, values.length - 1);
  const sd = Math.sqrt(variance);
  return sd > 1e-9 ? sd : 1;
}

/**
 * Fits the ordered logistic by gradient descent with a backtracking step.
 *
 * Numeric gradients: three parameters, and a derivation nobody has to check by
 * eye. What matters is the two guards around them. Differences are standardised
 * so every parameter lives on the same scale, and a step that makes the loss
 * worse halves the rate instead of being taken — without that, the descent
 * walks away from the answer and returns a confident-looking number that is
 * simply wrong.
 */
export function fit(observations: Observation[], steps = FIT_STEPS): OrderedLogistic {
  const scale = spread(observations);
  let current: OrderedLogistic = { ...INITIAL_FIT, scale };
  let rate = INITIAL_RATE;
  const epsilon = 1e-4;

  for (let step = 0; step < steps && rate > 1e-8; step += 1) {
    const base = logLoss(current, observations);
    if (!Number.isFinite(base)) break;

    const gradient = {
      beta: (logLoss({ ...current, beta: current.beta + epsilon }, observations) - base) / epsilon,
      lower:
        (logLoss({ ...current, lower: current.lower + epsilon }, observations) - base) / epsilon,
      upper:
        (logLoss({ ...current, upper: current.upper + epsilon }, observations) - base) / epsilon,
    };

    const next: OrderedLogistic = {
      scale,
      beta: current.beta - rate * gradient.beta,
      lower: current.lower - rate * gradient.lower,
      upper: current.upper - rate * gradient.upper,
    };
    if (next.upper < next.lower) {
      const middle = (next.upper + next.lower) / 2;
      next.lower = middle - epsilon;
      next.upper = middle + epsilon;
    }

    const candidate = logLoss(next, observations);
    if (!Number.isFinite(candidate) || candidate >= base) {
      // Uphill: the step was too big for this curvature. Try a smaller one.
      rate /= 2;
      continue;
    }
    current = next;
    if (base - candidate < 1e-9) break;
  }
  return current;
}

/**
 * Whether a fit is worth reporting at all.
 *
 * A fitted model that cannot beat the outcome frequencies **on the data it was
 * fitted to** has not converged; reporting its held-out score as evidence about
 * the weights would be reporting an arithmetic failure as a finding, which is
 * how the first version of this file nearly published "the index carries no
 * information".
 */
export function fitConverged(fitted: OrderedLogistic, train: Observation[]): boolean {
  const fittedLoss = logLoss(fitted, train);
  const naive = baseRateLogLoss(train, train);
  return Number.isFinite(fittedLoss) && fittedLoss <= naive + 1e-9;
}

/**
 * The share of decisive matches where the higher index won.
 *
 * Reported beside log-loss because it is the claim a reader will make of the
 * number anyway ("does the stronger team win?"), and because a weight set can
 * improve one and not the other — which is worth seeing rather than averaging
 * away.
 */
export function decisiveAccuracy(observations: Observation[]): number {
  const decisive = observations.filter((o) => o.outcome !== 'D');
  if (decisive.length === 0) return Number.NaN;
  const right = decisive.filter(
    (o) => (o.difference > 0 && o.outcome === 'H') || (o.difference < 0 && o.outcome === 'A'),
  );
  return right.length / decisive.length;
}

/**
 * The baseline every candidate has to beat before anything else is interesting:
 * the season's own outcome frequencies, which use no index at all.
 */
export function baseRateLogLoss(train: Observation[], test: Observation[]): number {
  const counts = { H: 0, D: 0, A: 0 };
  for (const observation of train) counts[observation.outcome] += 1;
  const total = train.length || 1;
  const rates = {
    H: clamp(counts.H / total),
    D: clamp(counts.D / total),
    A: clamp(counts.A / total),
  };
  if (test.length === 0) return Number.NaN;
  return (
    test.reduce((sum, observation) => sum + -Math.log(rates[observation.outcome]), 0) / test.length
  );
}

export type WeightSet = Partial<Record<PowerIndexComponent, number>>;

/** The blueprint's weights, as a candidate like any other. */
export const BLUEPRINT_WEIGHTS: WeightSet = { ...POWER_INDEX_WEIGHTS };

/**
 * The candidates. Deliberately few and deliberately named: a grid fine enough
 * to overfit 380 matches would find a winner every time, and the winner would
 * be noise. Each of these is a position somebody could argue for out loud.
 */
export const CANDIDATE_WEIGHTS: { name: string; weights: WeightSet }[] = [
  { name: 'blueprint', weights: BLUEPRINT_WEIGHTS },
  {
    name: 'strength-heavy',
    weights: {
      underlying_strength: 0.55,
      recent_form: 0.2,
      venue: 0.2,
      rest_and_congestion: 0.05,
    },
  },
  {
    name: 'form-heavy',
    weights: {
      underlying_strength: 0.25,
      recent_form: 0.5,
      venue: 0.2,
      rest_and_congestion: 0.05,
    },
  },
  {
    name: 'venue-heavy',
    weights: {
      underlying_strength: 0.35,
      recent_form: 0.2,
      venue: 0.4,
      rest_and_congestion: 0.05,
    },
  },
  {
    name: 'equal',
    weights: {
      underlying_strength: 0.25,
      recent_form: 0.25,
      venue: 0.25,
      rest_and_congestion: 0.25,
    },
  },
];

export interface CandidateResult {
  name: string;
  /** Log-loss on matches the fit never saw. Lower is better. */
  testLogLoss: number;
  trainLogLoss: number;
  decisiveAccuracy: number;
  /** False when the fit did not converge, so the two losses mean nothing. */
  converged: boolean;
  fit: OrderedLogistic;
}

export interface BacktestResult {
  division: string;
  matches: number;
  trainSize: number;
  testSize: number;
  baseRateLogLoss: number;
  candidates: CandidateResult[];
  /** The best candidate on held-out log-loss. */
  best: string;
  /**
   * Whether the best candidate beat the blueprint by enough to be worth a new
   * formula version. A margin smaller than this is noise at this sample size.
   */
  margin: number;
  verdict: string;
}

/** Below this improvement in held-out log-loss, a difference is not a finding. */
export const MEANINGFUL_MARGIN = 0.01;

/**
 * Scores every candidate on the same split and says what it means.
 *
 * The verdict is written here rather than left to the reader because the honest
 * answer is usually "keep the blueprint's numbers", and a table of five
 * near-identical log-losses invites picking the smallest one.
 */
export function score(
  division: string,
  byCandidate: Map<string, { train: Observation[]; test: Observation[] }>,
): BacktestResult {
  const candidates: CandidateResult[] = [];
  let matches = 0;
  let trainSize = 0;
  let testSize = 0;
  let baseRate = Number.NaN;

  for (const { name } of CANDIDATE_WEIGHTS) {
    const split = byCandidate.get(name);
    if (split === undefined) continue;
    const fitted = fit(split.train);
    candidates.push({
      name,
      trainLogLoss: logLoss(fitted, split.train),
      testLogLoss: logLoss(fitted, split.test),
      decisiveAccuracy: decisiveAccuracy(split.test),
      converged: fitConverged(fitted, split.train),
      fit: fitted,
    });
    matches = split.train.length + split.test.length;
    trainSize = split.train.length;
    testSize = split.test.length;
    baseRate = baseRateLogLoss(split.train, split.test);
  }

  // Only a converged fit can win: a diverged one produces a number, and the
  // number is about the arithmetic rather than about the weights.
  const ranked = candidates
    .filter((c) => c.converged)
    .sort((a, b) => a.testLogLoss - b.testLogLoss);
  const best = ranked[0];
  const blueprint = candidates.find((candidate) => candidate.name === 'blueprint');
  const margin =
    best === undefined || blueprint === undefined
      ? Number.NaN
      : blueprint.testLogLoss - best.testLogLoss;

  return {
    division,
    matches,
    trainSize,
    testSize,
    baseRateLogLoss: baseRate,
    candidates,
    best: best?.name ?? 'none',
    margin,
    verdict: verdictOf(
      best?.name ?? 'none',
      margin,
      baseRate,
      blueprint?.converged === true ? blueprint.testLogLoss : undefined,
      candidates.filter((c) => !c.converged).map((c) => c.name),
    ),
  };
}

function verdictOf(
  best: string,
  margin: number,
  baseRate: number,
  blueprintLoss: number | undefined,
  diverged: string[],
): string {
  if (diverged.length > 0 && blueprintLoss === undefined) {
    return `No verdict: the fit did not converge for ${diverged.join(', ')}, so the losses describe the arithmetic rather than the weights. Fix the fit before reading anything into this run.`;
  }
  if (blueprintLoss === undefined) return 'No candidate could be scored.';
  if (Number.isFinite(baseRate) && blueprintLoss >= baseRate) {
    return `The index carries no information this history can detect: the blueprint's weights score ${blueprintLoss.toFixed(4)} against ${baseRate.toFixed(4)} for the season's own outcome frequencies. Keep the published weights and do not claim predictive value.`;
  }
  if (best === 'blueprint' || !(margin > MEANINGFUL_MARGIN)) {
    return `Keep the published weights. The best alternative (${best}) improves held-out log-loss by ${margin.toFixed(4)}, below the ${MEANINGFUL_MARGIN} that would be a finding rather than noise at this sample size.`;
  }
  const caveat =
    diverged.length === 0 ? '' : ` (${diverged.join(', ')} did not converge and were excluded)`;
  return `Replace the published weights with "${best}" in a new formula version: it improves held-out log-loss by ${margin.toFixed(4)}${caveat}.`;
}
