import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ModerationModule } from '../moderation/moderation.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { SocialController } from './social.controller';
import { SocialService } from './social.service';

/**
 * The social graph boundary (blueprint 8.1, T-201): friends, requests, blocks.
 *
 * It imports the identity module's public service to know who is asking and
 * nothing else. In particular it does not import the profile module, even
 * though the profile module is its most important reader: the dependency runs
 * the other way — `ProfileModule` binds its `FriendshipOracle` port to this
 * service — which keeps the answer to "are these two friends?" in one place
 * without the boundary that asks and the boundary that answers importing each
 * other.
 */
@Module({
  imports: [IdentityModule, ModerationModule, NotificationsModule],
  controllers: [SocialController],
  providers: [SocialService],
  exports: [SocialService],
})
export class SocialModule {}
