import type { MatchOutcome, ModelProbabilities, ModelScorelineProbability } from '@fmip/contracts';

/**
 * How one forecast version did against a full-time score. The definitions
 * match `apps/model/fmip_model/backtest/metrics.py` so the stored evaluations
 * and the backtest reports are comparable number for number.
 */
export interface Scored {
  outcome: MatchOutcome;
  /** Probability the version gave the outcome that happened, as stored (4 dp). */
  p_outcome: number;
  /** -ln(p_outcome), 6 dp. Uniform is ln 3 ≈ 1.098612. */
  log_loss: number;
  /** Squared error summed over the three outcome indicators, 6 dp. Uniform is 2/3. */
  brier: number;
  /** The outcome that happened was the version's most probable one. */
  correct: boolean;
  /** The version's single most likely scoreline was the final score. */
  scoreline_hit: boolean;
}

/** ln 3 and 2/3: what a forecast that knows nothing scores. */
export const UNIFORM_LOG_LOSS = 1.098612;
export const UNIFORM_BRIER = 0.666667;

export function outcomeOf(home: number, away: number): MatchOutcome {
  if (home > away) return 'home';
  if (home < away) return 'away';
  return 'draw';
}

const round = (value: number, digits: number): number => {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
};

/** One outcome in three: what a uniform forecast gets right, in expectation. */
export const UNIFORM_ACCURACY = 0.333333;

/**
 * The ranked probability score (T-1369, D-187) over the ordered outcomes
 * home < draw < away: half the sum of squared differences between the
 * forecast's and the result's cumulative distributions at the first two
 * steps (the third is always 1 and 1). Unlike log loss and Brier it rewards
 * probability placed *near* the result: a home win forecast as a draw costs
 * less than one forecast as an away win. 0 is perfect, 1 the worst. 6 dp.
 *
 * Never stored: `evaluation` is immutable and has no column for it, and the
 * version's probabilities are on its `forecast` row, so it is computed when
 * read. `RPS_SQL` in `evaluation-store.ts` is the same formula for the
 * aggregates; `accuracy.http.spec.ts` holds the two to each other.
 */
export function rps(probabilities: ModelProbabilities, outcome: MatchOutcome): number {
  const cumulativeHome = probabilities.home;
  const cumulativeDraw = probabilities.home + probabilities.draw;
  const resultHome = outcome === 'home' ? 1 : 0;
  const resultDraw = outcome === 'away' ? 0 : 1;
  return round(((cumulativeHome - resultHome) ** 2 + (cumulativeDraw - resultDraw) ** 2) / 2, 6);
}

const UNIFORM = { home: 1 / 3, draw: 1 / 3, away: 1 / 3 } as const;

/** What a uniform forecast's RPS is on a result: 5/18 when decided, 1/9 for a draw. */
export const uniformRps = (outcome: MatchOutcome): number => rps(UNIFORM, outcome);

export function score(
  probabilities: ModelProbabilities,
  mostLikely: readonly ModelScorelineProbability[],
  home: number,
  away: number,
): Scored {
  const outcome = outcomeOf(home, away);
  const p = probabilities[outcome];
  const values = [probabilities.home, probabilities.draw, probabilities.away];
  const brier = (['home', 'draw', 'away'] as const).reduce(
    (total, o) => total + (probabilities[o] - (o === outcome ? 1 : 0)) ** 2,
    0,
  );
  const top = mostLikely[0];
  return {
    outcome,
    p_outcome: round(p, 4),
    // Clamped like metrics.py, so a 0.0000 stays finite (27.63) and fits the column.
    log_loss: round(-Math.log(Math.max(p, 1e-12)), 6),
    brier: round(brier, 6),
    correct: p === Math.max(...values),
    scoreline_hit: top !== undefined && top.home === home && top.away === away,
  };
}
