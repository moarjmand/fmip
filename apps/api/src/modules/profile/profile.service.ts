import { Inject, Injectable } from '@nestjs/common';
import type {
  OwnProfile,
  ProfileView,
  UpdatePrivacyRequest,
  UpdateProfileRequest,
} from '@fmip/contracts';
import { IdentityService } from '../identity/identity.service';
import { PostgresProfileStore, toPrivacy, toPublicProfile } from './internal/profile-store';
import { FRIENDSHIP_ORACLE, type FriendshipOracle, canView } from './internal/visibility';

/**
 * The profile boundary: what a member shows, and to whom (T-041). Privacy is
 * decided here, server-side, before anything is serialised; a page cannot
 * leak what it was never sent.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly store: PostgresProfileStore,
    private readonly identity: IdentityService,
    @Inject(FRIENDSHIP_ORACLE) private readonly friendships: FriendshipOracle,
  ) {}

  /** The profile as `viewerId` may see it, or `null` for an unknown username. */
  async view(username: string, viewerId: string | null): Promise<ProfileView | null> {
    const row = await this.store.findByUsername(username.toLowerCase());
    if (row === null) return null;

    const areFriends =
      viewerId !== null && viewerId !== row.user_id
        ? await this.friendships.areFriends(viewerId, row.user_id)
        : false;

    if (!canView(row.profile_visibility, row.user_id, viewerId, areFriends)) {
      return {
        kind: 'restricted',
        username: row.username,
        display_name: row.display_name,
        visibility: row.profile_visibility === 'friends' ? 'friends' : 'private',
      };
    }

    return { kind: 'visible', profile: toPublicProfile(row), is_self: viewerId === row.user_id };
  }

  async own(userId: string): Promise<OwnProfile | null> {
    const row = await this.store.findByUserId(userId);
    const account = await this.identity.userById(userId);
    if (row === null || account === null) return null;

    return { profile: toPublicProfile(row), account, privacy: toPrivacy(row) };
  }

  async updateProfile(userId: string, patch: UpdateProfileRequest): Promise<OwnProfile | null> {
    if (patch.display_name !== undefined) {
      await this.identity.updateDisplayName(userId, patch.display_name);
    }
    if (patch.bio !== undefined || patch.avatar_url !== undefined) {
      await this.store.upsertProfile(userId, { bio: patch.bio, avatarUrl: patch.avatar_url });
    }
    return this.own(userId);
  }

  async updatePrivacy(userId: string, patch: UpdatePrivacyRequest): Promise<OwnProfile | null> {
    await this.store.upsertPrivacy(userId, {
      profile: patch.profile_visibility,
      predictionHistory: patch.prediction_history_visibility,
    });
    return this.own(userId);
  }
}
