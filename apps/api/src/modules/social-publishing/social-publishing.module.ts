import { Module } from '@nestjs/common';
import { SocialCardController, SocialCardStore } from './social-card.controller';

/**
 * Posts to X and Instagram (D-427). So far the card's read (T-1835); the
 * store, service and scheduler join it in T-1838 and T-1837. Imports nothing
 * but the global database pool.
 */
@Module({
  controllers: [SocialCardController],
  providers: [SocialCardStore],
})
export class SocialPublishingModule {}
