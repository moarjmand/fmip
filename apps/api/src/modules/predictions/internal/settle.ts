import type { SettlementVoidReason } from '@fmip/contracts';
import type { FixtureFinal, NewSettlement, Settleable } from './settlement-store';

/**
 * The settlement rules (blueprint 6.6: "a postponed or abandoned match is
 * void until a valid settlement rule is applied"). Pure, so they are tested
 * without a database and readable as the rulebook they are.
 *
 *   finished + full-time score  → settled: outcome and exact score judged
 *   postponed / abandoned / cancelled / awarded → void, with that reason
 *   anything else (scheduled, live, suspended, finished without a score)
 *                               → not final: nothing is written yet
 *
 * A prediction already carrying the settlement this state calls for is left
 * alone, which is what makes a re-run idempotent; a void one is superseded
 * once the match is finished for real.
 */
export type Verdict =
  | { kind: 'settle'; actual: { home: number; away: number } }
  | { kind: 'void'; reason: SettlementVoidReason }
  | { kind: 'not_final' };

export function verdictFor(fixture: FixtureFinal): Verdict {
  switch (fixture.status) {
    case 'finished':
      return fixture.fullTime === null
        ? { kind: 'not_final' }
        : { kind: 'settle', actual: fixture.fullTime };
    case 'postponed':
    case 'abandoned':
    case 'cancelled':
    case 'awarded':
      return { kind: 'void', reason: fixture.status };
    default:
      return { kind: 'not_final' };
  }
}

export const outcomeOf = (home: number, away: number): 'home' | 'draw' | 'away' =>
  home > away ? 'home' : home < away ? 'away' : 'draw';

/** What to write for one prediction under a verdict, or null when nothing changes. */
export function settleOne(prediction: Settleable, verdict: Verdict): NewSettlement | null {
  if (verdict.kind === 'not_final') return null;
  const current = prediction.current;

  if (verdict.kind === 'void') {
    if (
      current !== null &&
      (current.status === 'settled' || current.voidReason === verdict.reason)
    ) {
      return null;
    }
    return {
      predictionId: prediction.predictionId,
      versionId: prediction.versionId,
      status: 'void',
      voidReason: verdict.reason,
      actual: null,
      outcomeCorrect: null,
      scorePredicted: prediction.score !== null,
      scoreCorrect: null,
      confidence: prediction.confidence,
    };
  }

  if (current !== null && current.status === 'settled') return null;
  const actualOutcome = outcomeOf(verdict.actual.home, verdict.actual.away);
  return {
    predictionId: prediction.predictionId,
    versionId: prediction.versionId,
    status: 'settled',
    voidReason: null,
    actual: verdict.actual,
    outcomeCorrect: prediction.outcome === actualOutcome,
    scorePredicted: prediction.score !== null,
    scoreCorrect:
      prediction.score === null
        ? null
        : prediction.score.home === verdict.actual.home &&
          prediction.score.away === verdict.actual.away,
    confidence: prediction.confidence,
  };
}
