import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import type {
  CoverageState,
  ForecastKind,
  ForecastVersion,
  ForecastListEntry,
  ForecastVersionsResponse,
  ModelForecastRequest,
  ModelXiStrength,
} from '@fmip/contracts';
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
 * not a competition's division but the scale the candidate puts them on.
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

    const request: ModelForecastRequest = {
      fixture_id: fixture.id,
      home_team_id: fixture.homeTeamId,
      away_team_id: fixture.awayTeamId,
      division: fixture.division ?? '',
      kickoff_at: fixture.kickoffAt.toISOString(),
    };

    if (fixture.division === null) {
      const version = await this.store.record({
        fixtureId,
        kind,
        modelId: 'none@0.0.0',
        request,
        computedAt: new Date(),
        available: null,
        // A cup's clubs come from different leagues and the model rates within
        // one, which is a different sentence from a league whose history is
        // not loaded (T-503).
        unavailable: fixture.mixesLeagues
          ? {
              reason: 'cross_competition',
              detail: `competition ${fixture.competitionId} matches clubs of different leagues`,
            }
          : {
              reason: 'competition_not_mapped',
              detail: `competition ${fixture.competitionId} has no football-data division`,
            },
      });
      // A cup's match goes to the candidate on the scale across leagues
      // (T-533, D-085): stored in shadow and shown nowhere, while the
      // published version keeps saying why it has no answer.
      if (fixture.mixesLeagues) {
        await this.shadow(fixtureId, kind, { ...request, division: CROSS_LEAGUE_DIVISION });
      }
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
   * The candidate model version's answer to the same question, stored as a
   * shadow version (T-531): immutable like any forecast, evaluated after the
   * match like any forecast, and shown nowhere until a decision promotes it
   * (T-535). Off the critical path by construction: a service with no
   * candidate answers 404, which is the usual state and records nothing, and
   * any other failure is logged while the published version stands.
   */
  private async shadow(
    fixtureId: string,
    kind: ForecastKind,
    request: ModelForecastRequest,
  ): Promise<void> {
    try {
      const result = await this.model.candidate(request);
      if (!result.ok) {
        if (result.kind !== 'http' || result.status !== 404) {
          this.log.warn(`shadow forecast not recorded: ${result.message}`, {
            event: 'forecast.shadow_failed',
            fixture_id: fixtureId,
          });
        }
        return;
      }
      await this.recordAnswer(fixtureId, kind, request, result, 'shadow');
    } catch (error: unknown) {
      this.log.warn('shadow forecast not recorded', {
        event: 'forecast.shadow_failed',
        fixture_id: fixtureId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /** One model answer -- an outage, a refusal, or a forecast -- as a stored version. */
  private async recordAnswer(
    fixtureId: string,
    kind: ForecastKind,
    request: ModelForecastRequest,
    result: Awaited<ReturnType<ModelClient['forecast']>>,
    role: 'published' | 'shadow',
  ): Promise<ForecastVersion> {
    if (!result.ok) {
      return this.store.record({
        fixtureId,
        kind,
        role,
        modelId: 'none@0.0.0',
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
        modelId: 'none@0.0.0',
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
}

/** The coverage state a list of versions amounts to (rule 3, rule 4). */
export function coverageOf(latest: ForecastVersion | null): CoverageState {
  if (latest === null || latest.status === 'unavailable') return 'not_supplied';
  return latest.data_completeness === 'available' ? 'available' : 'limited';
}
