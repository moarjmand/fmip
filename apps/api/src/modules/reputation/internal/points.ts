import type { PointsReason } from '@fmip/contracts';

/**
 * Career Points rules (blueprint 9.2), version 1. Points measure taking part
 * and achieving; they are a ledger, never a judgement of skill, and nothing
 * here is read by the Performance Rating or by any eligibility check.
 *
 * Every award is tied to the settlement that earned it, so the ledger can be
 * rebuilt from settlements alone and a re-run writes nothing new.
 */
export interface PointsRules {
  version: string;
  settled: number;
  correctOutcome: number;
  exactScore: number;
  /** A run of this many correct outcomes in a row earns the streak award, once per run. */
  streak5: number;
  streak10: number;
}

export const POINTS_RULES_V1: PointsRules = {
  version: 'career-points@1.0.0',
  settled: 1,
  correctOutcome: 3,
  exactScore: 5,
  streak5: 5,
  streak10: 15,
};

/** One settled prediction as the ledger sees it, oldest first. */
export interface PointsInput {
  settlementId: string;
  settledAt: string;
  correct: boolean;
  scoreCorrect: boolean | null;
}

export interface Award {
  settlementId: string;
  reason: PointsReason;
  points: number;
}

/**
 * Every award the history has earned. Streaks count consecutive correct
 * outcomes in settlement order; a streak of ten also passed five, so the
 * settlement completing the tenth earns both. Voids are not in the history
 * and neither break nor extend a streak.
 */
export function awardsFor(
  history: readonly PointsInput[],
  rules: PointsRules = POINTS_RULES_V1,
): Award[] {
  const ordered = [...history].sort(
    (a, b) =>
      a.settledAt.localeCompare(b.settledAt) || a.settlementId.localeCompare(b.settlementId),
  );
  const awards: Award[] = [];
  let streak = 0;
  for (const s of ordered) {
    awards.push({ settlementId: s.settlementId, reason: 'settled', points: rules.settled });
    if (s.correct) {
      awards.push({
        settlementId: s.settlementId,
        reason: 'correct_outcome',
        points: rules.correctOutcome,
      });
      streak += 1;
      if (streak % 5 === 0)
        awards.push({ settlementId: s.settlementId, reason: 'streak_5', points: rules.streak5 });
      if (streak % 10 === 0)
        awards.push({ settlementId: s.settlementId, reason: 'streak_10', points: rules.streak10 });
    } else {
      streak = 0;
    }
    if (s.scoreCorrect === true) {
      awards.push({
        settlementId: s.settlementId,
        reason: 'exact_score',
        points: rules.exactScore,
      });
    }
  }
  return awards;
}

/** The current streak of correct outcomes at the end of the history. */
export function currentStreak(history: readonly PointsInput[]): number {
  const ordered = [...history].sort(
    (a, b) =>
      a.settledAt.localeCompare(b.settledAt) || a.settlementId.localeCompare(b.settlementId),
  );
  let streak = 0;
  for (const s of ordered) streak = s.correct ? streak + 1 : 0;
  return streak;
}
