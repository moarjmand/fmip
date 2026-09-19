import { Module } from '@nestjs/common';
import { FollowingFeedModule } from '../following-feed/following-feed.module';
import { IdentityModule } from '../identity/identity.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { BriefingsController } from './briefings.controller';
import { BriefingsService } from './briefings.service';
import { PostgresBriefingStore } from './internal/briefing-store';

/**
 * Briefings (E43, Phase 5): the Following feed's public service, read into a
 * document and, when a model exists and the member asks, written over by
 * the model behind the intelligence port. Nothing imports it; delivery
 * (T-432) waits for a channel (T-330).
 */
@Module({
  imports: [FollowingFeedModule, IdentityModule, IntelligenceModule],
  controllers: [BriefingsController],
  providers: [PostgresBriefingStore, BriefingsService],
})
export class BriefingsModule {}
