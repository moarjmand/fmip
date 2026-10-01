import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { AdminModule } from './modules/admin/admin.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { FixturesModule } from './modules/fixtures/fixtures.module';
import { ForecastModule } from './modules/forecast/forecast.module';
import { ConsensusModule } from './modules/consensus/consensus.module';
import { FounderModule } from './modules/founder/founder.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { MediaModule } from './modules/media/media.module';
import { PredictionsModule } from './modules/predictions/predictions.module';
import { ProfileModule } from './modules/profile/profile.module';
import { ConversationsModule } from './modules/conversations/conversations.module';
import { ModerationModule } from './modules/moderation/moderation.module';
import { GroupsModule } from './modules/groups/groups.module';
import { SocialModule } from './modules/social/social.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { FollowingFeedModule } from './modules/following-feed/following-feed.module';
import { DeliveryModule } from './modules/delivery/delivery.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { PanelModule } from './modules/panel/panel.module';
import { ReputationModule } from './modules/reputation/reputation.module';
import { SearchModule } from './modules/search/search.module';
import { NewsModule } from './modules/news/news.module';
import { ViewingModule } from './modules/viewing/viewing.module';
import { IntelligenceModule } from './modules/intelligence/intelligence.module';
import { SummariesModule } from './modules/summaries/summaries.module';
import { AskModule } from './modules/ask/ask.module';
import { ModerationAssistModule } from './modules/moderation-assist/moderation-assist.module';
import { BriefingsModule } from './modules/briefings/briefings.module';
import { CampaignsModule } from './modules/campaigns/campaigns.module';
import { ChannelPostModule } from './modules/channel-post/channel-post.module';
import { WatchdogModule } from './modules/watchdog/watchdog.module';
import { FailureCountsModule } from './modules/failure-counts/failure-counts.module';
import { DataQualityModule } from './modules/data-quality/data-quality.module';
import { ActivityModule } from './modules/activity/activity.module';
import { RateLimitsModule } from './modules/rate-limits/rate-limits.module';
import { HomepageModule } from './modules/homepage/homepage.module';
import { LocaleHoldsModule } from './modules/locale-holds/locale-holds.module';
import { RatingThresholdsModule } from './modules/rating-thresholds/rating-thresholds.module';

/**
 * The remaining modules from `docs/02-architecture.md` are registered here as
 * they are built. Their directories exist under `src/modules/` already so that
 * the boundary is visible before any code fills it in. `DatabaseModule` is not
 * a boundary: it is the shared `pg` pool every boundary injects.
 */
@Module({
  imports: [
    DatabaseModule,
    HealthModule,
    CatalogModule,
    IngestionModule,
    MediaModule,
    IdentityModule,
    ProfileModule,
    SocialModule,
    ModerationModule,
    ConversationsModule,
    GroupsModule,
    ForecastModule,
    ConsensusModule,
    FounderModule,
    FixturesModule,
    PredictionsModule,
    ReputationModule,
    PanelModule,
    NotificationsModule,
    DeliveryModule,
    FollowingFeedModule,
    AnalysisModule,
    SearchModule,
    NewsModule,
    ViewingModule,
    IntelligenceModule,
    SummariesModule,
    AskModule,
    ModerationAssistModule,
    BriefingsModule,
    CampaignsModule,
    ChannelPostModule,
    WatchdogModule,
    FailureCountsModule,
    DataQualityModule,
    ActivityModule,
    RateLimitsModule,
    HomepageModule,
    LocaleHoldsModule,
    RatingThresholdsModule,
    AdminModule,
  ],
})
export class AppModule {}
