import { Module } from '@nestjs/common';
import { FailureCountsModule } from '../failure-counts/failure-counts.module';
import { IdentityModule } from '../identity/identity.module';
import { ProfileModule } from '../profile/profile.module';
import { PostgresBreakingAdminStore } from './internal/breaking-admin-store';
import { PostgresDebateAdminStore } from './internal/debate-admin-store';
import { PostgresNewsReadStore } from './internal/news-read-store';
import { FetchTransport, NEWS_TRANSPORT } from './internal/news-transport';
import { PostgresNewsStore } from './internal/news-store';
import { PostgresSavedArticlesStore } from './internal/saved-articles-store';
import { PostgresStoryLabelStore } from './internal/story-label-store';
import { NewsClusteringService } from './news-clustering.service';
import { NewsIngestionService } from './news-ingestion.service';
import { NewsSchedulerService } from './news-scheduler.service';
import { BreakingAdminController } from './breaking-admin.controller';
import { DebateAdminController } from './debate-admin.controller';
import { StoryTypeAdminController } from './story-type-admin.controller';
import { PostgresTranslationsAdminStore } from './internal/translations-admin-store';
import { TranslationsAdminController } from './translations-admin.controller';
import { NewsController } from './news.controller';
import { SavedArticlesController } from './saved-articles.controller';

/**
 * News (blueprint 3.3, E14): publishers' feeds read as headline and link
 * under the rights each source grants (D-061). Its own boundary because news
 * is not on the critical path (rule 9): a match, its score and its forecast
 * never depend on anything here, and this module imports none of them. It
 * imports identity (who is asking) and profile (whom they follow) for the
 * following section, through their public services. The transport is a
 * provider so a spec can script every response.
 */
@Module({
  imports: [IdentityModule, ProfileModule, FailureCountsModule],
  controllers: [
    NewsController,
    DebateAdminController,
    BreakingAdminController,
    StoryTypeAdminController,
    TranslationsAdminController,
    SavedArticlesController,
  ],
  providers: [
    PostgresNewsStore,
    PostgresNewsReadStore,
    PostgresDebateAdminStore,
    PostgresBreakingAdminStore,
    PostgresTranslationsAdminStore,
    PostgresSavedArticlesStore,
    PostgresStoryLabelStore,
    NewsClusteringService,
    NewsIngestionService,
    NewsSchedulerService,
    { provide: NEWS_TRANSPORT, useFactory: (): FetchTransport => new FetchTransport() },
  ],
  exports: [NewsIngestionService],
})
export class NewsModule {}
