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
