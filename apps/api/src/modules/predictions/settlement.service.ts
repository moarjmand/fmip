import { Injectable, Logger } from '@nestjs/common';
import type { FixtureSettlementsResponse } from '@fmip/contracts';
import { NotificationsService } from '../notifications/notifications.service';
import { settleOne, verdictFor } from './internal/settle';
import {
  PostgresSettlementStore,
  type MemberSettledRecord,
  type PredictedRound,
  type PredictionFirst,
  type SettledRecord,
} from './internal/settlement-store';

export type {
  MemberSettledRecord,
  PredictedRound,
  PredictionFirst,
  SettledRecord,
} from './internal/settlement-store';

export type SettleOutcome =
  | { kind: 'settled'; runId: string; settled: number; voided: number; unchanged: number }
  | { kind: 'not_final'; status: string }
  | { kind: 'unknown_fixture' };

/** How many fixtures one `settleDue` pass takes; the settlement tick (T-1380) calls it repeatedly. */
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
  private readonly log = new Logger('Settlement');

  constructor(
    private readonly store: PostgresSettlementStore,
    private readonly notifications: NotificationsService,
  ) {}

  async settleFixture(fixtureId: string): Promise<SettleOutcome> {
    const fixture = await this.store.fixtureFinal(fixtureId);
    if (fixture === null) return { kind: 'unknown_fixture' };
    const verdict = verdictFor(fixture);
    if (verdict.kind === 'not_final') return { kind: 'not_final', status: fixture.status };

    const predictions = await this.store.settleables(fixtureId);
    const rows = predictions
      .map((p) => settleOne(p, verdict))
      .filter((r): r is NonNullable<typeof r> => r !== null);
    // What the run actually wrote: another run may have settled some of
    // these between the read above and the write (T-1476).
    const written = await this.store.record(fixtureId, rows, predictions.length - rows.length);
    await this.tellCalled(written.called);
    return {
      kind: 'settled',
      runId: written.runId,
      settled: written.settled,
      voided: written.voided,
      unchanged: written.unchanged,
    };
  }

  /**
   * A correct pick, settled by this run, is told to its member with the way to
   * its card (T-1723, D-351): `prediction_settled`, once per prediction (the
   * dedupe key), sourceless. Only a correct pick: the notification is the
   * door to sharing it, and a wrong one has nothing to share. Never fails the
   * settlement, which is already committed (`emit` never throws either).
   */
  private async tellCalled(called: { predictionId: string; userId: string }[]): Promise<void> {
    if (called.length === 0) return;
    try {
      await this.notifications.emitMany(
        called.map(({ predictionId, userId }) => ({
          userId,
          kind: 'prediction_settled' as const,
          subjectType: 'prediction' as const,
          subjectId: predictionId,
          dedupeKey: `prediction_settled:${predictionId}`,
        })),
      );
    } catch (error) {
      this.log.error(
        `prediction_settled.failed predictions=${called.length}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  /**
   * The job's pass: settle every fixture that is final and still owes a
   * settlement. `fixtureIds` names the fixtures it settled, so the caller can
   * recompute the ratings of exactly the members who predicted them (T-1380).
   */
  async settleDue(): Promise<{
    fixtures: number;
    settled: number;
    voided: number;
    fixtureIds: string[];
  }> {
    const totals = { fixtures: 0, settled: 0, voided: 0, fixtureIds: [] as string[] };
    for (const fixtureId of await this.store.due(DUE_BATCH)) {
      const outcome = await this.settleFixture(fixtureId);
      if (outcome.kind === 'settled') {
        totals.fixtures += 1;
        totals.settled += outcome.settled;
        totals.voided += outcome.voided;
        totals.fixtureIds.push(fixtureId);
      }
    }
    return totals;
  }

  /** For the reputation boundary (T-053): a member's settled rows, oldest first. */
  settledHistory(userId: string): Promise<SettledRecord[]> {
    return this.store.settledHistory(userId);
  }

  /**
   * The same records, over a month or a season (T-641) and/or in one
   * competition (T-843), for a board computed on read.
   */
  settledInPeriod(filter: {
    among: string[] | null;
    from?: string;
    to?: string;
    seasonLabel?: string;
    competitionId?: string;
  }): Promise<MemberSettledRecord[]> {
    return this.store.settledInPeriod(filter);
  }

  /** Competitions with a settled prediction, most recently settled first (T-843). */
  settledCompetitions(limit: number): Promise<{ id: string; name: string }[]> {
    return this.store.settledCompetitions(limit);
  }

  /** A competition's name, or null when there is no such competition (T-843). */
  competitionName(id: string): Promise<string | null> {
    return this.store.competitionName(id);
  }

  /** The months and season labels a period board can be asked for, newest first. */
  async settledPeriods(limit: number): Promise<{ months: string[]; seasons: string[] }> {
    const [months, seasons] = await Promise.all([
      this.store.settledMonths(limit),
      this.store.settledSeasons(limit),
    ]);
    return { months, seasons };
  }

  /**
   * What achievements are derived from (T-643): the member's current settled
   * rows (the same query as `settledHistory`), each prediction's first
   * submission, and the rounds they predicted in.
   */
  async achievementFacts(userId: string): Promise<{
    settlements: SettledRecord[];
    predictions: PredictionFirst[];
    rounds: PredictedRound[];
  }> {
    const [settlements, predictions, rounds] = await Promise.all([
      this.store.settledHistory(userId),
      this.store.predictionFirsts(userId),
      this.store.predictedRounds(userId),
    ]);
    return { settlements, predictions, rounds };
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
