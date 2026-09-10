import { Inject, Injectable } from '@nestjs/common';
import type {
  FavouriteIds,
  FollowedEntity,
  FollowedEntityType,
  OwnProfile,
  ProfileView,
  UpdatePrivacyRequest,
  UpdateProfileRequest,
} from '@fmip/contracts';
import { IdentityService } from '../identity/identity.service';
import { PostgresFollowingStore } from './internal/following-store';
import { PostgresProfileStore, toPrivacy, toPublicProfile } from './internal/profile-store';
import { FRIENDSHIP_ORACLE, type FriendshipOracle, canView } from './internal/visibility';

// The module's public surface. Other modules import from this file only.
export {
  NO_FAVOURITES,
  type RankableFixture,
  compareByFavourites,
  favouriteRank,
} from './internal/favourite-order';

export type FollowOutcome = 'followed' | 'unknown_entity';

/**
 * The profile boundary: what a member shows, to whom, and what they follow
 * (T-041, T-042). Privacy is decided here, server-side, before anything is
 * serialised; a page cannot leak what it was never sent.
 */
@Injectable()
export class ProfileService {
  constructor(
    private readonly store: PostgresProfileStore,
    private readonly following: PostgresFollowingStore,
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

    return {
      kind: 'visible',
      profile: toPublicProfile(row, await this.following.favouriteTeamNames(row.user_id)),
      is_self: viewerId === row.user_id,
    };
  }

  async own(userId: string): Promise<OwnProfile | null> {
    const row = await this.store.findByUserId(userId);
    const account = await this.identity.userById(userId);
    if (row === null || account === null) return null;

    return {
      profile: toPublicProfile(row, await this.following.favouriteTeamNames(userId)),
      account,
      privacy: toPrivacy(row),
    };
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

  // --- following and favourites (T-042) ---------------------------------

  listFollowing(userId: string): Promise<FollowedEntity[]> {
    return this.following.list(userId);
  }

  /** Follows the entity (idempotent) and sets the favourite flag when given. */
  async follow(
    userId: string,
    type: FollowedEntityType,
    entityId: string,
    favourite: boolean | undefined,
  ): Promise<FollowOutcome> {
    if (!(await this.following.entityExists(type, entityId))) return 'unknown_entity';
    await this.following.upsert(userId, type, entityId, favourite);
    return 'followed';
  }

  /** Whether anything was removed. */
  unfollow(userId: string, type: FollowedEntityType, entityId: string): Promise<boolean> {
    return this.following.remove(userId, type, entityId);
  }

  /** For personalised views (the scores API, T-030): the id sets `compareByFavourites` ranks with. */
  favouriteIds(userId: string): Promise<FavouriteIds> {
    return this.following.favouriteIds(userId);
  }
}
