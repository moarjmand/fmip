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
import { CONGESTION_WINDOW_DAYS, percentile, type RestInput } from './power-index-measure';

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

/**
 * The stored schedule (T-1111): each club's distinct match days, oldest first.
 *
 * The rows are every `training.match` row, clubs keyed through
 * `training.team_alias` (a bridged club by its catalogue id, else
 * `<division>:<name>`), so a club's cup matches in our records count toward
 * its league rest when the bridge joins them -- the same rows the model's rest
 * input reads (D-141).
 */
export function scheduleOf(rows: readonly { club: string; date: string }[]): Map<string, string[]> {
  const days = new Map<string, Set<string>>();
  for (const { club, date } of rows) {
    const set = days.get(club) ?? new Set<string>();
    set.add(date);
    days.set(club, set);
  }
  return new Map([...days].map(([club, set]) => [club, [...set].sort()]));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What the schedule said about a club before `date` (ISO): days since its
 * previous match and its matches in the congestion window, from its matches
 * strictly before that day, as the live store measures a kick-off (T-111).
 * No earlier match: `daysSincePrevious` is null and the component is absent.
 */
export function restBefore(
  days: readonly string[] | undefined,
  date: string,
  windowDays = CONGESTION_WINDOW_DAYS,
): RestInput {
  const day = Date.parse(`${date}T00:00:00Z`);
  const earlier = (days ?? []).filter((d) => d < date);
  const previous = earlier.at(-1);
  if (previous === undefined) return { daysSincePrevious: null, matchesInWindow: 0 };
  const since = day - windowDays * DAY_MS;
  return {
    daysSincePrevious: Math.round((day - Date.parse(`${previous}T00:00:00Z`)) / DAY_MS),
    matchesInWindow: earlier.filter((d) => Date.parse(`${d}T00:00:00Z`) >= since).length,
  };
}

/**
 * A season's stored fixture list (T-1123, D-146), read for sides and days only,
 * as the league-stakes input reads it (D-143): the matches each side plays, and
 * whether the list is a complete double round robin. A split league, a list
 * with play-offs in it, or a season still being loaded is incomplete, and an
 * incomplete list gives no stake.
 */
export interface SeasonList {
  totals: Map<string, number>;
  complete: boolean;
}

export function seasonListOf(fixtures: readonly { home: string; away: string }[]): SeasonList {
  const totals = new Map<string, number>();
  const pairs = new Set<string>();
  for (const { home, away } of fixtures) {
    totals.set(home, (totals.get(home) ?? 0) + 1);
    totals.set(away, (totals.get(away) ?? 0) + 1);
    pairs.add(JSON.stringify([home, away]));
  }
  const n = totals.size;
  return {
    totals,
    complete: n >= 2 && fixtures.length === n * (n - 1) && pairs.size === fixtures.length,
  };
}

/**
 * Each side's open places (T-1123, D-146): the number of other sides it can
 * still finish level with or on either side of, from the table and the matches
 * left. A rival is closed when it is out of reach (`points(U) > points(T) + 3 *
 * left(T)`) or `T` is out of its reach (`points(T) > points(U) + 3 *
 * left(U)`); every other rival is open. It is also the number of places the side
 * can still move between its best and its worst finish, and zero exactly when
 * the side is locked under D-143's rule.
 */
export function openPlaces(
  points: ReadonlyMap<string, number>,
  left: ReadonlyMap<string, number>,
): Map<string, number> {
  const open = new Map<string, number>();
  for (const [team, mine] of points) {
    const reach = 3 * (left.get(team) ?? 0);
    let count = 0;
    for (const [other, theirs] of points) {
      if (other === team) continue;
      const above = theirs > mine + reach;
      const below = mine > theirs + 3 * (left.get(other) ?? 0);
      if (!above && !below) count += 1;
    }
    open.set(team, count);
  }
  return open;
}

/** One side's stake before a match: its open places, and their position among the division's. */
export interface Stake {
  open: number;
  rivals: number;
  /** Mid-rank percentile of `open` among every side of the table. A locked side is lowest. */
  value: number;
}

/**
 * Every side's stake before `date`, from the season's results strictly before
 * that day (three points a win, D-038; deductions are not stored) and the
 * season's list. `null` when the list is not a complete double round robin, so
 * the component is absent and its weight redistributed (rule 3).
 */
export function stakesBefore(
  list: SeasonList | undefined,
  results: readonly {
    date: string;
    home: string;
    away: string;
    homeGoals: number;
    awayGoals: number;
  }[],
  date: string,
): Map<string, Stake> | null {
  if (list === undefined || !list.complete) return null;
  const points = new Map([...list.totals.keys()].map((team) => [team, 0]));
  const played = new Map([...list.totals.keys()].map((team) => [team, 0]));
  for (const m of results) {
    if (m.date >= date || !points.has(m.home) || !points.has(m.away)) continue;
    played.set(m.home, (played.get(m.home) ?? 0) + 1);
    played.set(m.away, (played.get(m.away) ?? 0) + 1);
    const home = m.homeGoals > m.awayGoals ? 3 : m.homeGoals === m.awayGoals ? 1 : 0;
    const away = m.awayGoals > m.homeGoals ? 3 : m.homeGoals === m.awayGoals ? 1 : 0;
    points.set(m.home, (points.get(m.home) ?? 0) + home);
    points.set(m.away, (points.get(m.away) ?? 0) + away);
  }
  const left = new Map(
    [...list.totals].map(([team, total]) => [team, total - (played.get(team) ?? 0)]),
  );
  const open = openPlaces(points, left);
  const population = [...open.values()];
  return new Map(
    [...open].map(([team, count]) => [
      team,
      { open: count, rivals: population.length - 1, value: percentile(count, population) },
    ]),
  );
}

export type WeightSet = Partial<Record<PowerIndexComponent, number>>;

/**
 * The published arithmetic (`power-index@1.1.0`) as a candidate like any other:
 * the blueprint's weights, with competition context unmeasured. A weight of 0
 * and an absent component combine identically (both are left out of the
 * supplied weight), so this is exactly what the live index computes today.
 */
export const BLUEPRINT_WEIGHTS: WeightSet = { ...POWER_INDEX_WEIGHTS, competition_context: 0 };

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
  // T-1111: the rest component's own question -- does it earn its 5%, or more?
  { name: 'without-rest', weights: { ...BLUEPRINT_WEIGHTS, rest_and_congestion: 0 } },
  { name: 'rest-heavy', weights: { ...BLUEPRINT_WEIGHTS, rest_and_congestion: 0.15 } },
  // T-1123: competition context -- a side's stake as a position among the
  // division's -- at the blueprint's 5%, and heavier.
  { name: 'with-context', weights: { ...BLUEPRINT_WEIGHTS, competition_context: 0.05 } },
  { name: 'context-heavy', weights: { ...BLUEPRINT_WEIGHTS, competition_context: 0.15 } },
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
  /**
   * T-1111: held-out log loss without the rest component minus the
   * blueprint's. Positive: rest helped. `null` when either was not scored.
   */
  restContribution: number | null;
  /**
   * T-1123: the published arithmetic's held-out log loss minus `with-context`'s.
   * Positive: measuring competition context helped. `null` when either was not scored.
   */
  contextContribution: number | null;
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

  const withoutRest = candidates.find((candidate) => candidate.name === 'without-rest');
  const restContribution =
    withoutRest?.converged === true && blueprint?.converged === true
      ? withoutRest.testLogLoss - blueprint.testLogLoss
      : null;

  const withContext = candidates.find((candidate) => candidate.name === 'with-context');
  const contextContribution =
    withContext?.converged === true && blueprint?.converged === true
      ? blueprint.testLogLoss - withContext.testLogLoss
      : null;

  return {
    division,
    matches,
    trainSize,
    testSize,
    baseRateLogLoss: baseRate,
    candidates,
    best: best?.name ?? 'none',
    margin,
    restContribution,
    contextContribution,
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
