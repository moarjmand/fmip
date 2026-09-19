import { Module } from '@nestjs/common';
import { FollowingFeedModule } from '../following-feed/following-feed.module';
import { IdentityModule } from '../identity/identity.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BriefingsController } from './briefings.controller';
import { BriefingsService } from './briefings.service';
import { PostgresBriefingStore } from './internal/briefing-store';

/**
 * Briefings (E43, Phase 5): the Following feed's public service, read into a
 * document and, when a model exists and the member asks, written over by
 * the model behind the intelligence port. Nothing imports it. A published
 * briefing is the same notification the inbox has (T-432), carried outward
 * through the delivery port, which says when nothing can carry it (T-330).
 */
@Module({
  imports: [FollowingFeedModule, IdentityModule, IntelligenceModule, NotificationsModule],
  controllers: [BriefingsController],
  providers: [PostgresBriefingStore, BriefingsService],
})
export class BriefingsModule {}
