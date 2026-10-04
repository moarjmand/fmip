import { Controller, Get, Module } from '@nestjs/common';
import type { HighlightsFeedHealth } from '@fmip/contracts';
import { FailureCountsModule } from '../failure-counts/failure-counts.module';
import { IdentityModule } from '../identity/identity.module';
import { EntityResolverService } from '../ingestion/ingestion.service';
import { ProfileModule } from '../profile/profile.module';
import { HIGHLIGHT_FEED_CONFIG, HighlightFeedService } from './highlight-feed.service';
import { feedConfig } from './internal/highlight-feed';
import { PostgresHighlightFeedStore } from './internal/highlight-feed-store';
import { FetchJsonTransport, HIGHLIGHT_FEED_TRANSPORT } from './internal/highlight-feed-transport';
import { PostgresViewingAdminStore } from './internal/viewing-admin-store';
import { PostgresViewingReadStore } from './internal/viewing-read-store';
import { ViewingAdminController } from './viewing-admin.controller';
import { ViewingController } from './viewing.controller';
import { ViewingDefaultsSchedulerService } from './viewing-defaults-scheduler.service';
import { ViewingService } from './viewing.service';

/**
 * `GET /health/highlights` (T-1366): whether the highlights feed is on, whether
 * this process runs it, today's requests against its ceiling and the newest
 * run. `absent` -- no `HIGHLIGHTLY_KEY` -- is reported as a fact.
 */
@Controller()
export class HighlightFeedHealthController {
  constructor(private readonly feed: HighlightFeedService) {}

  @Get('health/highlights')
  health(): HighlightsFeedHealth {
    return this.feed.health();
  }
}

/**
 * Watch and highlights (blueprint 11, E31): where a match can be watched in
 * the viewer's territory and where its highlight is, under the rights each
 * source grants (T-311), from the editorial desk (T-313, D-069) and, for
 * highlights, a licensed feed beside it (T-1366, D-184). Its own boundary:
 * not on the critical path (rule 9), so a match, its score and its forecast
 * never depend on it, and it imports only identity (who is asking), profile
 * (their territory), failure counts (the jobs' failures, T-1360) and the
 * ingestion boundary's public resolver (the feed's team ids, T-1366).
 */
@Module({
  imports: [IdentityModule, ProfileModule, FailureCountsModule],
  controllers: [ViewingController, ViewingAdminController, HighlightFeedHealthController],
  providers: [
    PostgresViewingReadStore,
    PostgresViewingAdminStore,
    PostgresHighlightFeedStore,
    ViewingService,
    ViewingDefaultsSchedulerService,
    HighlightFeedService,
    // The ingestion boundary's public resolver over the shared pool: the feed's team ids are
    // placed or queued exactly as every adapter's are, without pulling the jobs in.
    EntityResolverService,
    { provide: HIGHLIGHT_FEED_CONFIG, useFactory: () => feedConfig(process.env) },
    {
      provide: HIGHLIGHT_FEED_TRANSPORT,
      useFactory: (): FetchJsonTransport => new FetchJsonTransport(),
    },
  ],
  exports: [ViewingService],
})
export class ViewingModule {}
