import { Injectable } from '@nestjs/common';
import type {
  FixtureEvaluationsResponse,
  ForecastEvaluation,
  ModelPerformanceResponse,
} from '@fmip/contracts';
import { PostgresEvaluationStore } from './internal/evaluation-store';
import { UNIFORM_BRIER, UNIFORM_LOG_LOSS, score } from './internal/scoring';

export type EvaluateOutcome =
  | { kind: 'evaluated'; added: number; evaluations: ForecastEvaluation[] }
  | { kind: 'not_finished'; status: string }
  | { kind: 'no_final_score' }
  | { kind: 'unknown_fixture' };

/**
 * Post-match evaluation (T-066): once a fixture has a full-time score, every
 * available forecast version is scored against it, once, immutably. Model
 * performance per competition is then a query over those rows.
 *
 * Nothing here decides which model is good: it records what happened and
 * what each version said, and serves honest aggregates that exclude versions
 * computed after kick-off. The D-016 verdict stays with the backtest.
 */
@Injectable()
export class EvaluationService {
  constructor(private readonly store: PostgresEvaluationStore) {}

  async evaluateFixture(fixtureId: string): Promise<EvaluateOutcome> {
    const fixture = await this.store.fixtureResult(fixtureId);
    if (fixture === null) return { kind: 'unknown_fixture' };
    if (fixture.status !== 'finished') return { kind: 'not_finished', status: fixture.status };
    if (fixture.fullTime === null) return { kind: 'no_final_score' };

    const actual = fixture.fullTime;
    let added = 0;
    for (const version of await this.store.unevaluated(fixtureId)) {
      const scored = score(version.probabilities, version.mostLikely, actual.home, actual.away);
      if (await this.store.record(version, fixture, actual, scored)) added += 1;
    }
    return { kind: 'evaluated', added, evaluations: await this.store.evaluations(fixtureId) };
  }

  async evaluations(fixtureId: string): Promise<FixtureEvaluationsResponse | null> {
    if ((await this.store.fixtureResult(fixtureId)) === null) return null;
    const evaluations = await this.store.evaluations(fixtureId);
    const last = evaluations.at(-1);
    return {
      fixture_id: fixtureId,
      coverage: evaluations.length === 0 ? 'not_supplied' : 'available',
      last_updated_at: last?.evaluated_at ?? null,
      evaluations,
    };
  }

  async performance(
    competitionId: string,
    seasonId: string | null,
  ): Promise<ModelPerformanceResponse | null> {
    if (!(await this.store.competitionExists(competitionId))) return null;
    const [rows, totals] = await Promise.all([
      this.store.performanceRows(competitionId, seasonId),
      this.store.performanceTotals(competitionId, seasonId),
    ]);
    // Limited when finished fixtures exist that no pre-kick-off version covers:
    // the figures are real but describe only part of the competition.
    const coverage =
      rows.length === 0
        ? 'not_supplied'
        : totals.fixturesEvaluated < totals.finishedFixtures
          ? 'limited'
          : 'available';
    return {
      competition_id: competitionId,
      season_id: seasonId,
      coverage,
      last_updated_at: totals.lastUpdatedAt?.toISOString() ?? null,
      finished_fixtures: totals.finishedFixtures,
      fixtures_evaluated: totals.fixturesEvaluated,
      unavailable_versions: totals.unavailableVersions,
      post_kickoff_versions: totals.postKickoffVersions,
      reference: { uniform_log_loss: UNIFORM_LOG_LOSS, uniform_brier: UNIFORM_BRIER },
      rows,
    };
  }
}
