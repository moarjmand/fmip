import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PostgresFollowingStore } from './internal/following-store';
import { PostgresProfileStore } from './internal/profile-store';
import { FRIENDSHIP_ORACLE, NoFriendshipsYet } from './internal/visibility';
import { ProfileController } from './profile.controller';
import { ProfileService } from './profile.service';

/**
 * The profile boundary (02-architecture.md): profiles, privacy, and (T-042)
 * favourites and following. It imports the identity module's public service
 * to know who is asking; it never touches identity's tables directly.
 */
@Module({
  imports: [IdentityModule],
  controllers: [ProfileController],
  providers: [
    ProfileService,
    PostgresProfileStore,
    PostgresFollowingStore,
    { provide: FRIENDSHIP_ORACLE, useClass: NoFriendshipsYet },
  ],
  exports: [ProfileService],
})
export class ProfileModule {}
