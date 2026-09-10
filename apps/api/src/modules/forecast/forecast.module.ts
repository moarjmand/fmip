import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ForecastController } from './forecast.controller';
import { MODEL_CLIENT, ForecastService, ModelClient } from './forecast.service';
import { PostgresForecastStore } from './internal/forecast-store';

/** Reads MODEL_SERVICE_URL; refuses to guess. */
export function modelClientFromEnv(env: NodeJS.ProcessEnv = process.env): ModelClient {
  const baseUrl = env.MODEL_SERVICE_URL;
  if (baseUrl === undefined || baseUrl === '') {
    throw new Error('MODEL_SERVICE_URL is not set; see .env.example and docs/03-project-map.md.');
  }
  return new ModelClient({ baseUrl });
}

/**
 * The forecast boundary (02-architecture.md): the contract with the model
 * service and the immutable forecast versions.
 */
@Module({
  imports: [IdentityModule],
  controllers: [ForecastController],
  providers: [
    ForecastService,
    PostgresForecastStore,
    { provide: MODEL_CLIENT, useFactory: (): ModelClient => modelClientFromEnv() },
  ],
  exports: [ForecastService],
})
export class ForecastModule {}
