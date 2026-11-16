import { Module } from '@nestjs/common';
import { SocialCardController, SocialCardStore } from './social-card.controller';

/**
 * The social posts' card read (T-1835, D-427 point 11), apart from
 * `SocialPublishingModule` (T-1838) so the two land without touching each
 * other: it reads `social_post` alone, through the global database pool, and
 * imports nothing.
 */
@Module({
  controllers: [SocialCardController],
  providers: [SocialCardStore],
})
export class SocialCardModule {}
