import { Injectable } from '@nestjs/common';
import type { FixtureSettlementsResponse } from '@fmip/contracts';
import { settleOne, verdictFor } from './internal/settle';
import { PostgresSettlementStore, type SettledRecord } from './internal/settlement-store';

export type { SettledRecord } from './internal/settlement-store';

export type SettleOutcome =
  | { kind: 'settled'; runId: string; settled: number; voided: number; unchanged: number }
  | { kind: 'not_final'; status: string }
  | { kind: 'unknown_fixture' };

/** How many fixtures one `settleDue` pass takes; the job runner (T-026) calls it repeatedly. */
export const DUE_BATCH = 50;

/**
 * Settlement (T-052): every prediction on a final fixture gets its settlement
 * row, once; a void one is superseded when the match is finished for real.
 * Re-running is the normal case (scores arrive, get corrected, jobs retry)
 * and writes nothing new when nothing changed. Every run is recorded with
 * what it wrote, so an operator can see that a re-run was a no-op.
 */
@Injectable()
export class SettlementService {
  constructor(private readonly store: PostgresSettlementStore) {}

  async settleFixture(fixtureId: string): Promise<SettleOutcome> {
    const fixture = await this.store.fixtureFinal(fixtureId);
    if (fixture === null) return { kind: 'unknown_fixture' };
    const verdict = verdictFor(fixture);
    if (verdict.kind === 'not_final') return { kind: 'not_final', status: fixture.status };

    const predictions = await this.store.settleables(fixtureId);
    const rows = predictions
      .map((p) => settleOne(p, verdict))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    const { runId } = await this.store.record(fixtureId, rows, predictions.length - rows.length);
    return {
      kind: 'settled',
      runId,
      settled: rows.filter((r) => r.status === 'settled').length,
      voided: rows.filter((r) => r.status === 'void').length,
      unchanged: predictions.length - rows.length,
    };
  }

  /** The job's pass: settle every fixture that is final and still owes a settlement. */
  async settleDue(): Promise<{ fixtures: number; settled: number; voided: number }> {
    const totals = { fixtures: 0, settled: 0, voided: 0 };
    for (const fixtureId of await this.store.due(DUE_BATCH)) {
      const outcome = await this.settleFixture(fixtureId);
      if (outcome.kind === 'settled') {
        totals.fixtures += 1;
        totals.settled += outcome.settled;
        totals.voided += outcome.voided;
      }
    }
    return totals;
  }

  /** For the reputation boundary (T-053): a member's settled rows, oldest first. */
  settledHistory(userId: string): Promise<SettledRecord[]> {
    return this.store.settledHistory(userId);
  }

  predictors(fixtureId: string): Promise<string[]> {
    return this.store.predictors(fixtureId);
  }

  recentlySettledUsers(limit: number): Promise<string[]> {
    return this.store.recentlySettledUsers(limit);
  }

  async forFixture(fixtureId: string): Promise<FixtureSettlementsResponse | null> {
    const fixture = await this.store.fixtureFinal(fixtureId);
    if (fixture === null) return null;
    const rows = await this.store.forFixture(fixtureId);
    // Current per prediction: the newest row (the store orders newest first).
    const seen = new Set<string>();
    const current = rows.filter((r) => {
      if (seen.has(r.prediction_id)) return false;
      seen.add(r.prediction_id);
      return true;
    });
    const settled = current.filter((s) => s.status === 'settled');
    return {
      fixture_id: fixtureId,
      fixture_status: fixture.status,
      predictions: current.length,
      settled: settled.length,
      void: current.length - settled.length,
      outcome_correct: settled.filter((s) => s.outcome_correct === true).length,
      score_correct: settled.filter((s) => s.score_correct === true).length,
      last_settled_at: current[0]?.settled_at ?? null,
    };
  }
}
