import { Inject, Injectable } from '@nestjs/common';
import type {
  CoverageState,
  ForecastKind,
  ForecastVersion,
  ForecastListEntry,
  ForecastVersionsResponse,
  ModelForecastRequest,
} from '@fmip/contracts';
import { PostgresForecastStore } from './internal/forecast-store';
import { ModelClient } from './internal/model-client';
import { roundToTotalOne } from './internal/rounding';

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
@Injectable()
export class ForecastService {
  constructor(
    private readonly store: PostgresForecastStore,
    @Inject(MODEL_CLIENT) private readonly model: ModelClient,
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
      return { kind: 'recorded', version };
    }

    const result = await this.model.forecast(request);

    if (!result.ok) {
      const version = await this.store.record({
        fixtureId,
        kind,
        modelId: 'none@0.0.0',
        request,
        computedAt: new Date(),
        available: null,
        unavailable: {
          reason: result.kind === 'contract' ? 'contract_violation' : 'model_unreachable',
          detail: result.message,
        },
      });
      return { kind: 'recorded', version };
    }

    const answer = result.data;
    if (answer.status === 'unavailable') {
      const version = await this.store.record({
        fixtureId,
        kind,
        modelId: 'none@0.0.0',
        request,
        computedAt: new Date(answer.computed_at),
        available: null,
        unavailable: { reason: answer.reason, detail: answer.detail },
      });
      return { kind: 'recorded', version };
    }

    const version = await this.store.record({
      fixtureId,
      kind,
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
    return { kind: 'recorded', version };
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
