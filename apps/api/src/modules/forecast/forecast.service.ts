import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
  CoverageState,
  ForecastKind,
  ForecastVersion,
  ForecastListEntry,
  ForecastSummaryEntry,
  ForecastVersionsResponse,
  CandidateShadowHealth,
  ModelCandidate,
  ModelEloSource,
  ModelForecastRequest,
  ModelXiStrength,
} from '@fmip/contracts';
import { CANDIDATE_FAILURE_LOOKBACK_DAYS } from '@fmip/contracts';
import { PostgresForecastStore } from './internal/forecast-store';
import { ModelClient } from './internal/model-client';
import { roundToTotalOne } from './internal/rounding';
import { PowerIndexService } from './power-index.service';

// The module's public surface. Other modules import from this file only.
export { ModelClient, contractProblems } from './internal/model-client';
export { roundToTotalOne } from './internal/rounding';
export { EvaluationService, type EvaluateOutcome } from './evaluation.service';
export { UNIFORM_BRIER, UNIFORM_LOG_LOSS, outcomeOf, score } from './internal/scoring';

export const MODEL_CLIENT = Symbol('MODEL_CLIENT');

const DAY_MS = 24 * 60 * 60 * 1000;

export type ComputeOutcome =
  { kind: 'recorded'; version: ForecastVersion } | { kind: 'unknown_fixture' };

/**
 * The forecast boundary (T-064): asks the model, stores what it was asked and
 * what it answered as an immutable version, and serves the versions.
 *
 * Every answer is stored, including "the model could not say": that is a
 * fact about the fixture at that moment, and the match centre labels it
 * rather than showing an empty panel (rule 3). The only things this service
 * never does are update a version or invent a probability.
 */
/**
 * The model's name for a match between clubs of different leagues (D-085):
 * not a competition's division but the scale a version with `cross_league`
 * puts them on (the published 0.6.0 since D-191).
 */
export const CROSS_LEAGUE_DIVISION = 'XL';

@Injectable()
export class ForecastService {
  private readonly log = new Logger('Forecast');

  constructor(
    private readonly store: PostgresForecastStore,
    @Inject(MODEL_CLIENT) private readonly model: ModelClient,
    /** Where each side's XI strength comes from (T-534); absent in tests that do not need it. */
    @Optional()
    @Inject(PowerIndexService)
    private readonly squads?: Pick<PowerIndexService, 'xiStrengths'>,
  ) {}

  async compute(fixtureId: string, kind: ForecastKind): Promise<ComputeOutcome> {
    const fixture = await this.store.fixtureForModel(fixtureId);
    if (fixture === null) return { kind: 'unknown_fixture' };

    // A match between clubs of different leagues is asked on the scale across
    // leagues (T-533, D-085), of the published version as of every candidate
    // (D-191): a version with that scale answers it, one without says why
    // not in its own words, and either answer is stored like a league's. The
    // published version answered `cross_competition` without being asked
    // until D-191; those rows stay as they were (rule 5).
    const division = fixture.division ?? (fixture.mixesLeagues ? CROSS_LEAGUE_DIVISION : null);
    const request: ModelForecastRequest = {
      fixture_id: fixture.id,
      home_team_id: fixture.homeTeamId,
      away_team_id: fixture.awayTeamId,
      division: division ?? '',
      kickoff_at: fixture.kickoffAt.toISOString(),
    };

    if (division === null) {
      const version = await this.store.record({
        fixtureId,
        kind,
        modelId: 'none@0.0.0',
        request,
        computedAt: new Date(),
        available: null,
        unavailable: {
          reason: 'competition_not_mapped',
          detail: `competition ${fixture.competitionId} has no football-data division`,
        },
      });
      return { kind: 'recorded', version };
    }

    // Both XIs, when both can be measured (T-534): part of the question, so
    // part of what the forecast stores, whether or not a version uses it.
    const xi = await this.xiStrength(fixtureId);
    const asked: ModelForecastRequest = xi === null ? request : { ...request, xi_strength: xi };
    const result = await this.model.forecast(asked);
    const version = await this.recordAnswer(fixtureId, kind, asked, result, 'published');
    await this.shadow(fixtureId, kind, asked);
    return { kind: 'recorded', version };
  }

  /** Both sides' XI strength, or null -- never a reason to fail the forecast. */
  private async xiStrength(fixtureId: string): Promise<ModelXiStrength | null> {
    if (this.squads === undefined) return null;
    try {
      return await this.squads.xiStrengths(fixtureId);
    } catch (error: unknown) {
      this.log.warn('XI strength not measured', {
        event: 'forecast.xi_strength_failed',
        fixture_id: fixtureId,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
  }

  /**
   * Every candidate model version's answer to the same question, each stored
   * as a shadow version (T-531, T-1102, D-140): immutable like any forecast,
   * numbered within its own model version, evaluated after the match like any
   * forecast, and shown nowhere until a decision promotes it (T-535). Off the
   * critical path by construction: no candidate is the usual state and
   * records nothing, and a candidate that fails is logged while the others
   * and the published version stand.
   */
  private async shadow(
    fixtureId: string,
    kind: ForecastKind,
    request: ModelForecastRequest,
  ): Promise<void> {
    let candidates: ModelCandidate[];
    try {
      const listed = await this.model.candidates();
      if (!listed.ok) {
        // 404: a service from before T-1102, which offers no named candidate.
        if (listed.kind !== 'http' || listed.status !== 404) {
          this.shadowFailed(fixtureId, null, listed.message);
        }
        return;
      }
      candidates = listed.data;
    } catch (error: unknown) {
      this.shadowFailed(fixtureId, null, error instanceof Error ? error.message : String(error));
      return;
    }
    for (const candidate of candidates) {
      try {
        const result = await this.model.candidate(candidate.name, request);
        if (!result.ok) {
          this.shadowFailed(fixtureId, candidate.model_version, result.message);
          continue;
        }
        await this.recordAnswer(
          fixtureId,
          kind,
          request,
          result,
          'shadow',
          candidate.model_version,
        );
      } catch (error: unknown) {
        this.shadowFailed(
          fixtureId,
          candidate.model_version,
          error instanceof Error ? error.message : String(error),
        );
      }
    }
  }

  private shadowFailed(fixtureId: string, modelVersion: string | null, error: string): void {
    this.log.warn(`shadow forecast not recorded: ${error}`, {
      event: 'forecast.shadow_failed',
      fixture_id: fixtureId,
      model_version: modelVersion,
      error,
    });
  }

  /** One model answer -- an outage, a refusal, or a forecast -- as a stored version. */
  private async recordAnswer(
    fixtureId: string,
    kind: ForecastKind,
    request: ModelForecastRequest,
    result: Awaited<ReturnType<ModelClient['forecast']>>,
    role: 'published' | 'shadow',
    /**
     * The version a shadow's `unavailable` answer is stored under: the
     * candidate that gave it, so each candidate's numbering is its own (D-140).
     */
    answeredBy = 'none@0.0.0',
  ): Promise<ForecastVersion> {
    if (!result.ok) {
      return this.store.record({
        fixtureId,
        kind,
        role,
        modelId: answeredBy,
        request,
        computedAt: new Date(),
        available: null,
        unavailable: {
          reason: result.kind === 'contract' ? 'contract_violation' : 'model_unreachable',
          detail: result.message,
        },
      });
    }

    const answer = result.data;
    if (answer.status === 'unavailable') {
      return this.store.record({
        fixtureId,
        kind,
        role,
        modelId: answeredBy,
        request,
        computedAt: new Date(answer.computed_at),
        available: null,
        unavailable: { reason: answer.reason, detail: answer.detail },
      });
    }

    return this.store.record({
      fixtureId,
      kind,
      role,
      modelId: answer.inputs.model_version,
      request,
      computedAt: new Date(answer.computed_at),
      available: {
        probabilities: roundToTotalOne(answer.probabilities),
        expectedGoals: answer.expected_goals,
        mostLikely: answer.most_likely_scorelines,
        leadingFactors: answer.leading_factors,
        inputs: answer.inputs,
      },
      unavailable: null,
    });
  }

  /**
   * The model service's own health check (T-801's watchdog): a value, never a
   * throw. `reason` is the client's description of what failed. `eloSource`
   * is Club Elo's recorded state (T-920), null from a service that does not
   * report it; `candidateVersions` the versions in shadow (T-1102), null
   * likewise.
   */
  async modelHealth(): Promise<
    | {
        ok: true;
        modelVersion: string;
        eloSource: ModelEloSource | null;
        candidateVersions: string[] | null;
      }
    | { ok: false; reason: string }
  > {
    const result = await this.model.health();
    return result.ok
      ? {
          ok: true,
          modelVersion: result.data.model_version,
          eloSource: result.data.elo_source ?? null,
          candidateVersions: result.data.candidate_versions ?? null,
        }
      : { ok: false, reason: `${result.kind}: ${result.message}` };
  }

  /**
   * Each shadow model version with a stored version, and whether it answers
   * (T-1165): the day is the 24 hours before `now`, and a failure is looked
   * for over `CANDIDATE_FAILURE_LOOKBACK_DAYS`. A version with nothing stored
   * is absent: it has never answered.
   */
  async candidateShadow(now: Date = new Date()): Promise<Map<string, CandidateShadowHealth>> {
    const since = new Date(now.getTime() - CANDIDATE_FAILURE_LOOKBACK_DAYS * DAY_MS);
    const rows = await this.store.candidateShadow(since, new Date(now.getTime() - DAY_MS), now);
    return new Map(
      rows.map((row) => [
        row.modelVersion,
        {
          first_answered_at: row.firstAt.toISOString(),
          last_answered_at: row.lastAt.toISOString(),
          day: { asked: row.dayAsked, failed: row.dayFailed },
          last_failure:
            row.lastFailure === null
              ? null
              : { at: row.lastFailure.at.toISOString(), fixture_id: row.lastFailure.fixtureId },
        },
      ]),
    );
  }

  async versions(fixtureId: string): Promise<ForecastVersionsResponse | null> {
    if ((await this.store.fixtureForModel(fixtureId)) === null) return null;

    const versions = await this.store.versions(fixtureId);
    const latest = versions.at(-1) ?? null;

    return {
      fixture_id: fixtureId,
      coverage: coverageOf(latest),
      last_updated_at: latest?.computed_at ?? null,
      latest,
      versions,
    };
  }

  /**
   * The latest forecast for several fixtures, in the order asked (T-136).
   *
   * Only the latest: a list is for scanning, and the version history that makes
   * the per-fixture endpoint worth reading belongs where there is room to
   * explain it. A fixture the model has no answer for comes back with `latest`
   * null, which is a normal state and not an omission.
   */
  async latestFor(fixtureIds: string[]): Promise<ForecastListEntry[]> {
    if (fixtureIds.length === 0) return [];
    const latest = await this.store.latestForFixtures(fixtureIds);
    return fixtureIds.map((id) => ({ fixture_id: id, latest: latest.get(id) ?? null }));
  }

  /**
   * The latest version computed before kick-off, as a summary, for several
   * fixtures in the order asked (T-940, D-114): what the scores card shows.
   * `pre_kickoff` null means the model was not asked, or answered only after
   * the match began.
   */
  async preKickoffFor(fixtureIds: string[]): Promise<ForecastSummaryEntry[]> {
    if (fixtureIds.length === 0) return [];
    const summaries = await this.store.preKickoffSummaries(fixtureIds);
    return fixtureIds.map((id) => ({ fixture_id: id, pre_kickoff: summaries.get(id) ?? null }));
  }
}

/** The coverage state a list of versions amounts to (rule 3, rule 4). */
export function coverageOf(latest: ForecastVersion | null): CoverageState {
  if (latest === null || latest.status === 'unavailable') return 'not_supplied';
  return latest.data_completeness === 'available' ? 'available' : 'limited';
}
