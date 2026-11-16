import { Module } from '@nestjs/common';
import { AgentsConsoleModule } from '../agents-console/agents-console.module';
import { FixturesModule } from '../fixtures/fixtures.module';
import { ForecastModule } from '../forecast/forecast.module';
import { NewsModule } from '../news/news.module';
import { PostgresSocialPostStore } from './internal/social-post-store';
import {
  SOCIAL_OPTIONS,
  SocialPublishingService,
  type SocialOptions,
  socialOptionsFromEnv,
} from './social-publishing.service';

/**
 * Posts to X and Instagram (T-1838, D-427; not `social/`, the friends graph).
 * Owns `social_post`, `social_automation` and `social_switch`. Reads the
 * scores list, the model's forecasts and their stored evaluations, and the
 * news headlines through their public services only -- no founder's analysis,
 * no consensus (rule 6) -- and writes its console actions' audit rows through
 * the agents console's exported writer. Publishing (T-1837), the cards
 * (T-1835) and the console tab (T-1836) build on `SocialPublishingService`.
 */
@Module({
  imports: [FixturesModule, ForecastModule, NewsModule, AgentsConsoleModule],
  providers: [
    PostgresSocialPostStore,
    SocialPublishingService,
    { provide: SOCIAL_OPTIONS, useFactory: (): SocialOptions => socialOptionsFromEnv() },
  ],
  exports: [SocialPublishingService],
})
export class SocialPublishingModule {}
