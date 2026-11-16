import { Controller, Get, Module } from '@nestjs/common';
import type { SocialPublishingHealth } from '@fmip/contracts';
import { AgentsConsoleModule } from '../agents-console/agents-console.module';
import { FailureCountsModule } from '../failure-counts/failure-counts.module';
import { FixturesModule } from '../fixtures/fixtures.module';
import { ForecastModule } from '../forecast/forecast.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { NewsModule } from '../news/news.module';
import { BufferPublisher } from './internal/buffer-publisher';
import { type SecretBox, SOCIAL_SECRET_BOX, secretBoxFromEnv } from './internal/secret-box';
import { PostgresSocialPostStore } from './internal/social-post-store';
import { SocialPublishingScheduler } from './social-publishing-scheduler.service';
import {
  SOCIAL_OPTIONS,
  SocialPublishingService,
  type SocialOptions,
  socialOptionsFromEnv,
} from './social-publishing.service';
import { SOCIAL_PUBLISHER, type SocialPublisher } from './social-publisher.port';

/**
 * `GET /health/social` (T-1837): whether a key is set (never the key),
 * whether publishing is stopped, whether this instance runs the job, any
 * pause the provider asked for, and the last publication per network.
 */
@Controller()
export class SocialPublishingHealthController {
  constructor(private readonly scheduler: SocialPublishingScheduler) {}

  @Get('health/social')
  health(): Promise<SocialPublishingHealth> {
    return this.scheduler.health();
  }
}

/**
 * Posts to X and Instagram (T-1838, T-1837, D-427; not `social/`, the
 * friends graph). Owns `social_post`, `social_automation`, `social_switch`
 * and `social_credential`. Reads the scores list, the model's forecasts and
 * their stored evaluations, and the news headlines through their public
 * services only -- no founder's analysis, no consensus (rule 6) -- with when
 * the fixtures list was last read in full (`IngestRunsService.lastGlobalSuccess`,
 * the forecast's freshness), and writes its console actions' audit rows
 * through the agents console's exported writer. Publishes through the
 * `SocialPublisher` port, Buffer behind it, on its own job
 * (`SocialPublishingScheduler`); the console tab (T-1836) builds on
 * `SocialPublishingService`; the card's read is `social-card.module.ts`.
 */
@Module({
  imports: [
    FixturesModule,
    ForecastModule,
    NewsModule,
    AgentsConsoleModule,
    IngestionModule,
    FailureCountsModule,
  ],
  controllers: [SocialPublishingHealthController],
  providers: [
    PostgresSocialPostStore,
    SocialPublishingService,
    SocialPublishingScheduler,
    { provide: SOCIAL_OPTIONS, useFactory: (): SocialOptions => socialOptionsFromEnv() },
    { provide: SOCIAL_SECRET_BOX, useFactory: (): SecretBox | null => secretBoxFromEnv() },
    {
      provide: SOCIAL_PUBLISHER,
      useFactory: (store: PostgresSocialPostStore, box: SecretBox | null): SocialPublisher =>
        new BufferPublisher(store, box),
      inject: [PostgresSocialPostStore, SOCIAL_SECRET_BOX],
    },
  ],
  exports: [SocialPublishingService],
})
export class SocialPublishingModule {}
