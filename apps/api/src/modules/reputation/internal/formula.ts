import { createHash } from 'node:crypto';
import type { RatingComponents, RatingTier } from '@fmip/contracts';

/**
 * The Performance Rating formula (blueprint 9.1), version 1. Everything a
 * rating depends on is in this file: the weights, the windows, the
 * thresholds and the tier bands. A change to any of them is a new version
 * string, and every snapshot records which version produced it (rule 8: a
 * rating is recomputable from stored records and this config alone).
 *
 * Difficulty is the model's pre-kick-off probability of the outcome that
 * happened, read from the stored forecast versions (immutable, T-064). A
 * correct pick earns `1 − difficulty`; with no forecast the neutral 1/3 is
 * used, so without a model the result component is plain accuracy. Credit is
 * normalised against the neutral case, which is what stops "always pick the
 * strongest favourite" from reaching an elite rating: twenty correct picks at
 * 80% model probability earn 0.2 each, twenty at 20% earn 0.8 each.
 */
export interface RatingFormula {
  version: string;
  /** How many most recent settled predictions count. */
  window: number;
  weights: { result: number; exactScore: number; consistency: number; confidence: number };
  /** Exact-score hit rate is scaled by this before capping at 1 (exact scores are rare). */
  exactScale: number;
  /** Consistency looks at this many most recent predictions, in blocks of this size. */
  consistencyWindow: number;
  consistencyBlock: number;
  /** Below this many settled predictions consistency is neutral (0.5). */
  consistencyMin: number;
  /** Difficulty used when no pre-kick-off forecast exists. */
  neutralDifficulty: number;
  provisionalBelow: number;
  establishedAt: number;
  /** Upper bounds (exclusive) for the tiers below elite. */
  tiers: { bronze: number; silver: number; gold: number; platinum: number };
}

export const RATING_FORMULA_V1: RatingFormula = {
  version: 'performance-rating@1.0.0',
  window: 100,
  weights: { result: 0.6, exactScore: 0.2, consistency: 0.15, confidence: 0.05 },
  exactScale: 4,
  consistencyWindow: 20,
  consistencyBlock: 5,
  consistencyMin: 10,
  neutralDifficulty: 1 / 3,
  provisionalBelow: 30,
  establishedAt: 50,
  tiers: { bronze: 40, silver: 55, gold: 70, platinum: 85 },
};

/** One settled prediction as the formula sees it. */
export interface RatingInput {
  /** The settlement id; ordered and hashed so unchanged inputs are detectable. */
  settlementId: string;
  settledAt: string;
  correct: boolean;
  scorePredicted: boolean;
  scoreCorrect: boolean | null;
  /** 1–5. */
  confidence: number;
  /** Model probability of the outcome that happened, before kick-off; null when none. */
  difficulty: number | null;
}

export interface RatingResult {
  rating: number;
  tier: RatingTier;
  provisional: boolean;
  established: boolean;
  settledCount: number;
  components: RatingComponents;
  inputsHash: string;
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
const round4 = (v: number): number => Math.round(v * 10_000) / 10_000;
const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));

export function tierOf(rating: number, formula: RatingFormula): RatingTier {
  if (rating < formula.tiers.bronze) return 'bronze';
  if (rating < formula.tiers.silver) return 'silver';
  if (rating < formula.tiers.gold) return 'gold';
  if (rating < formula.tiers.platinum) return 'platinum';
  return 'elite';
}

/** The identity of a computation: which rows, in which order, under which formula. */
export function inputsHash(inputs: readonly RatingInput[], formula: RatingFormula): string {
  const hash = createHash('sha256');
  hash.update(formula.version);
  for (const input of inputs) hash.update(`|${input.settlementId}`);
  return hash.digest('hex');
}

/**
 * Computes a rating over settled predictions (oldest first). Null when there
 * is nothing settled: a rating of 0 would look like a judgement.
 */
export function computeRating(
  history: readonly RatingInput[],
  formula: RatingFormula = RATING_FORMULA_V1,
): RatingResult | null {
  const ordered = [...history].sort(
    (a, b) =>
      a.settledAt.localeCompare(b.settledAt) || a.settlementId.localeCompare(b.settlementId),
  );
  const inputs = ordered.slice(-formula.window);
  const n = inputs.length;
  if (n === 0) return null;

  // Result: difficulty-adjusted credit, normalised against the neutral case.
  const neutralCredit = 1 - formula.neutralDifficulty;
  const earned = inputs.reduce(
    (sum, i) => sum + (i.correct ? 1 - (i.difficulty ?? formula.neutralDifficulty) : 0),
    0,
  );
  const result = clamp01(earned / (n * neutralCredit));

  // Exact score: hits over every settled prediction, scaled because exact scores are rare.
  const exactHits = inputs.filter((i) => i.scoreCorrect === true).length;
  const exactScore = clamp01((exactHits / n) * formula.exactScale);

  // Consistency: spread of accuracy across recent blocks; neutral with too little history.
  const recent = inputs.slice(-formula.consistencyWindow);
  let consistency = 0.5;
  if (recent.length >= formula.consistencyMin) {
    const blocks: number[] = [];
    for (
      let end = recent.length;
      end - formula.consistencyBlock >= 0;
      end -= formula.consistencyBlock
    ) {
      const block = recent.slice(end - formula.consistencyBlock, end);
      blocks.push(block.filter((i) => i.correct).length / block.length);
    }
    consistency = clamp01(1 - (Math.max(...blocks) - Math.min(...blocks)));
  }

  // Confidence: rewarded when right, costly when wrong.
  const confidence = clamp01(
    inputs.reduce((sum, i) => {
      const c = (i.confidence - 1) / 4;
      return sum + (i.correct ? c : 1 - c);
    }, 0) / n,
  );

  const total =
    formula.weights.result * result +
    formula.weights.exactScore * exactScore +
    formula.weights.consistency * consistency +
    formula.weights.confidence * confidence;
  const rating = round1(100 * clamp01(total));

  return {
    rating,
    tier: tierOf(rating, formula),
    provisional: n < formula.provisionalBelow,
    established: n >= formula.establishedAt,
    settledCount: n,
    components: {
      result: round4(result),
      exact_score: round4(exactScore),
      consistency: round4(consistency),
      confidence: round4(confidence),
    },
    inputsHash: inputsHash(inputs, formula),
  };
}
