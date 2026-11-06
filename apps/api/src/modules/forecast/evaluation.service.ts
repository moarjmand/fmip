import { Injectable } from '@nestjs/common';
import type {
  AccuracyPeriod,
  AdminModelAccuracyResponse,
  ConsoleModelReport,
  FixtureEvaluationsResponse,
  ForecastEvaluation,
  ModelPerformanceResponse,
  PublicModelAccuracyResponse,
} from '@fmip/contracts';
import { consoleModelReport, inputState } from './internal/console-model';
import { type CountedRow, PostgresEvaluationStore } from './internal/evaluation-store';
import { adminAccuracy, publicAccuracy } from './internal/model-accuracy';
import { UNIFORM_BRIER, UNIFORM_LOG_LOSS, score } from './internal/scoring';

export type CountedEvaluation = CountedRow;

const DAY_MS = 86_400_000;

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

  /**
   * Per fixture asked, the stored evaluation the accuracy figures count --
   * the last published version computed before kick-off (D-209) -- with the
   * probabilities it was scored on, or null; and whether such a version is
   * available at all, scored or not yet (T-1430: the channel's results post).
   * A fixture that does not exist is absent from the map.
   */
  async countedFor(fixtureIds: string[]): Promise<Map<string, CountedEvaluation>> {
    return this.store.counted(fixtureIds);
  }

  /** The console's accuracy over time (T-1369): every version, published and shadow. */
  async adminAccuracy(period: AccuracyPeriod, now: Date): Promise<AdminModelAccuracyResponse> {
    return adminAccuracy(await this.store.accuracySums(period, 'by_model'), period, now);
  }

  /** The public page's figures (T-1369): published forecasts only, by month or ISO week (T-1413). */
  async publicAccuracy(period: AccuracyPeriod = 'month'): Promise<PublicModelAccuracyResponse> {
    const [rows, competitions] = await Promise.all([
      this.store.accuracySums(period, 'published'),
      this.store.publishedCompetitions(),
    ]);
    return publicAccuracy(rows, competitions, period);
  }

  /**
   * The agents console's model page (T-1729, D-355). `versions` is what the
   * model service says it runs now (its published version and its shadow
   * candidates, null when it named none), or null when it did not answer:
   * then the published version is the newest published forecast's and the
   * candidates are those that stored a shadow forecast in the last week.
   * T-1752 (D-371): every version that stored a forecast is in the answer,
   * in each role, with its own record, calibration and trend, and every two
   * of them on the matches both scored. The trends are the console's weekly
   * accuracy series (T-1369), read, not computed a second time.
   */
  async consoleModel(
    versions: { published: string; candidates: string[] | null } | null,
    now: Date,
  ): Promise<ConsoleModelReport> {
    const published = versions?.published ?? (await this.store.newestPublishedModel());
    const listed = versions?.candidates ?? null;
    const shadow = (
      listed ?? (await this.store.recentShadowModels(new Date(now.getTime() - 7 * DAY_MS)))
    ).filter((id) => id !== published);
    const [counts, records, calibration, pairs, weekly, inputs, newDivisions, unscored] =
      await Promise.all([
        this.store.versionCounts(),
        this.store.versionRecords(),
        this.store.versionCalibration(),
        this.store.versionPairs(),
        this.adminAccuracy('week', now),
        // A count that cannot be read is said as "not counted", never guessed.
        this.store.modelInputs(now).catch(() => []),
        Promise.all(
          shadow.map(async (id) => [id, await this.store.newDivisionsCount(id)] as const),
        ),
        published === null
          ? Promise.resolve(null)
          : this.store.unscored(published).catch(() => null),
      ]);
    return consoleModelReport({
      service: versions === null ? 'unreachable' : 'answered',
      published,
      shadow,
      inService: (id) => (listed === null ? null : listed.includes(id)),
      counts,
      records,
      calibration,
      pairs,
      unscored,
      trends: weekly.series,
      inputs: inputs.map((row) => inputState(row, now)),
      newDivisions: new Map(newDivisions),
      now,
    });
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
