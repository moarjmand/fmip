import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { PostgresSuggestionStore } from './internal/suggestion-store';
import { ModerationAssistController } from './moderation-assist.controller';
import { ModerationAssistService } from './moderation-assist.service';

/**
 * Moderation assistance (E44, Phase 5): suggestions beside reports, from
 * the language model behind the intelligence port, for a moderator who
 * decides. Imports identity (who is asking) and the port; the moderation
 * module imports this one's public service to show suggestions in its
 * queue, and this one never imports moderation -- a suggestion is a row
 * beside a report, never a hand on it.
 */
@Module({
  imports: [IdentityModule, IntelligenceModule],
  controllers: [ModerationAssistController],
  providers: [PostgresSuggestionStore, ModerationAssistService],
  exports: [ModerationAssistService],
})
export class ModerationAssistModule {}
