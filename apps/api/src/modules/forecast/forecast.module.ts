import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { EvaluationController } from './evaluation.controller';
import { EvaluationService } from './evaluation.service';
import { ForecastController } from './forecast.controller';
import { MODEL_CLIENT, ForecastService, ModelClient } from './forecast.service';
import { PostgresEvaluationStore } from './internal/evaluation-store';
import { PostgresForecastStore } from './internal/forecast-store';

/** `MODEL_SERVICE_URL=off`: this deployment has no model service, and says so. */
export const NO_MODEL_SERVICE = 'off';

export const NO_MODEL_SERVICE_REASON = 'no model service is configured for this deployment';

/**
 * Reads MODEL_SERVICE_URL; refuses to guess.
 *
 * A deployment can legitimately have no model service — the preview image of
 * T-086 is one, because a free instance cannot hold the Python service too.
 * `off` is how that is declared, and it is not the same as forgetting: a missing
 * variable still refuses to boot. With `off`, every forecast is recorded as
 * `model_unreachable` with the reason below, which is what the pages already
 * know how to show. Nothing pretends a forecast is on its way.
 */
export function modelClientFromEnv(env: NodeJS.ProcessEnv = process.env): ModelClient {
  const baseUrl = env.MODEL_SERVICE_URL;
  if (baseUrl === undefined || baseUrl === '') {
    throw new Error('MODEL_SERVICE_URL is not set; see .env.example and docs/03-project-map.md.');
  }
  if (baseUrl.trim().toLowerCase() === NO_MODEL_SERVICE) {
    return new ModelClient({
      baseUrl: 'http://model.not-configured.invalid',
      fetchImpl: () => Promise.reject(new Error(NO_MODEL_SERVICE_REASON)),
    });
  }
  return new ModelClient({ baseUrl });
}

/**
 * The forecast boundary (02-architecture.md): the contract with the model
 * service, the immutable forecast versions, and their post-match evaluation.
 */
@Module({
  imports: [IdentityModule],
  controllers: [ForecastController, EvaluationController],
  providers: [
    ForecastService,
    PostgresForecastStore,
    EvaluationService,
    PostgresEvaluationStore,
    { provide: MODEL_CLIENT, useFactory: (): ModelClient => modelClientFromEnv() },
  ],
  exports: [ForecastService, EvaluationService],
})
export class ForecastModule {}
