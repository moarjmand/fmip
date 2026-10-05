import { Module } from '@nestjs/common';
import { FailureCountsModule } from '../failure-counts/failure-counts.module';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProfileModule } from '../profile/profile.module';
import { PostgresBreakingAdminStore } from './internal/breaking-admin-store';
import { PostgresDebateAdminStore } from './internal/debate-admin-store';
import { PostgresNewsCoverageStore } from './internal/news-coverage-store';
import { PostgresNewsReadStore } from './internal/news-read-store';
import { FetchTransport, NEWS_TRANSPORT } from './internal/news-transport';
import { PostgresNewsImageStore } from './internal/news-image-store';
import { NEWS_IMAGE_FETCH, fetchImage, mediaDir } from './internal/news-media';
import { MEDIA_ROOT, NewsImagesService } from './news-images.service';
import { NewsImageAdminController, NewsMediaController } from './news-media.controller';
import { PostgresNewsStore } from './internal/news-store';
import { PostgresSavedArticlesStore } from './internal/saved-articles-store';
import { PostgresStoryLabelStore } from './internal/story-label-store';
import { CATEGORY_MAPPING, STORY_TYPE_MAPPING } from './internal/story-type-mapping';
import { PostgresNewsSourcesAdminStore } from './internal/news-sources-admin-store';
import { NewsClusteringService } from './news-clustering.service';
import { NewsIngestionService } from './news-ingestion.service';
import { NewsSchedulerService } from './news-scheduler.service';
import { GNewsIngestionService } from './gnews-ingestion.service';
import { PostgresGNewsStore } from './internal/gnews-store';
import { BreakingAdminController } from './breaking-admin.controller';
import { BreakingAlertsService } from './breaking-alerts.service';
import { StoryTypeAlertsService } from './story-type-alerts.service';
import { DebateAdminController } from './debate-admin.controller';
import { StoryTypeAdminController } from './story-type-admin.controller';
import { PostgresTranslationsAdminStore } from './internal/translations-admin-store';
import { TranslationsAdminController } from './translations-admin.controller';
import { NewsController } from './news.controller';
import { NewsCoverageAdminController } from './news-coverage-admin.controller';
import { SavedArticlesController } from './saved-articles.controller';
import { NewsSourcesAdminController } from './news-sources-admin.controller';

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
  // Notifications for the breaking alert (T-1005) and the transfer and
  // availability alerts (T-1032); it imports nothing back.
  imports: [IdentityModule, ProfileModule, FailureCountsModule, NotificationsModule],
  controllers: [
    NewsController,
    DebateAdminController,
    BreakingAdminController,
    StoryTypeAdminController,
    TranslationsAdminController,
    NewsCoverageAdminController,
    SavedArticlesController,
    NewsSourcesAdminController,
    NewsMediaController,
    NewsImageAdminController,
  ],
  providers: [
    PostgresNewsStore,
    PostgresNewsReadStore,
    PostgresNewsCoverageStore,
    PostgresDebateAdminStore,
    PostgresBreakingAdminStore,
    BreakingAlertsService,
    StoryTypeAlertsService,
    PostgresTranslationsAdminStore,
    PostgresSavedArticlesStore,
    PostgresStoryLabelStore,
    NewsClusteringService,
    NewsIngestionService,
    NewsSchedulerService,
    // T-1367 (D-185): English stories from GNews, off without GNEWS_API_KEY.
    PostgresGNewsStore,
    GNewsIngestionService,
    PostgresNewsSourcesAdminStore,
    { provide: CATEGORY_MAPPING, useValue: STORY_TYPE_MAPPING },
    { provide: NEWS_TRANSPORT, useFactory: (): FetchTransport => new FetchTransport() },
    // T-1322 (D-177): photos, downloaded to MEDIA_DIR and served from our own route.
    PostgresNewsImageStore,
    NewsImagesService,
    { provide: NEWS_IMAGE_FETCH, useFactory: () => fetchImage() },
    { provide: MEDIA_ROOT, useFactory: (): string | null => mediaDir() },
  ],
  exports: [NewsIngestionService, NewsClusteringService],
})
export class NewsModule {}
