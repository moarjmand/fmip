import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { SocialModule } from '../social/social.module';
import { SocialService } from '../social/social.service';
import { PostgresFollowingStore } from './internal/following-store';
import { PostgresProfileStore } from './internal/profile-store';
import { FRIENDSHIP_ORACLE, type FriendshipOracle } from './internal/visibility';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

/**
 * The profile boundary (02-architecture.md): profiles, privacy, and (T-042)
 * favourites and following. It imports the identity module's public service
 * to know who is asking; it never touches identity's tables directly.
 *
 * **The `friends` visibility became real here (T-201).** `FRIENDSHIP_ORACLE`
 * is the port `canView` has asked since T-041, and its only implementation
 * answered no, which meant a member who chose "friends only" had chosen
 * nobody. It is now the social boundary's public service, adapted in one line.
 * The adapter lives on this side because `FriendshipOracle` is this module's
 * internal: the social module must not import it, and this one may import the
 * social module's public service.
 */
@Module({
  imports: [IdentityModule, SocialModule],
  controllers: [ProfileController],
  providers: [
    ProfileService,
    PostgresProfileStore,
    PostgresFollowingStore,
    {
      provide: FRIENDSHIP_ORACLE,
      useFactory: (social: SocialService): FriendshipOracle => ({
        areFriends: (a, b) => social.areFriends(a, b),
      }),
      inject: [SocialService],
    },
  ],
  exports: [ProfileService],
})
export class ProfileModule {}
