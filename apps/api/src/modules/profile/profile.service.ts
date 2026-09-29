import { Inject, Injectable } from '@nestjs/common';
import type {
  Territory,
  ViewingTerritory,
  FavouriteIds,
  FollowedEntity,
  FollowedEntityType,
  FirstRunState,
  OwnProfile,
  ProfileView,
  UpdatePreferencesRequest,
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

/**
 * `favourite_match`: a match is never pinned. `follow_ended`: the match's
 * follow window closed three hours after full-time (D-116).
 */
export type FollowOutcome = 'followed' | 'unknown_entity' | 'favourite_match' | 'follow_ended';

/** What the predictions boundary asks before serialising a member's history (T-056). */
export type HistoryAccess =
  | { kind: 'unknown' }
  | { kind: 'restricted'; username: string; visibility: 'friends' | 'private' }
  | { kind: 'visible'; userId: string; username: string; isSelf: boolean };

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

  /**
   * Whether `viewerId` may read `username`'s prediction history (blueprint
   * 7.2: the history has its own visibility setting). The same `canView`
   * rule as the profile, applied to `prediction_history_visibility`.
   */
  async predictionHistoryAccess(username: string, viewerId: string | null): Promise<HistoryAccess> {
    const row = await this.store.findByUsername(username.toLowerCase());
    if (row === null) return { kind: 'unknown' };

    const areFriends =
      viewerId !== null && viewerId !== row.user_id
        ? await this.friendships.areFriends(viewerId, row.user_id)
        : false;

    if (!canView(row.prediction_history_visibility, row.user_id, viewerId, areFriends)) {
      return {
        kind: 'restricted',
        username: row.username,
        visibility: row.prediction_history_visibility === 'friends' ? 'friends' : 'private',
      };
    }
    return {
      kind: 'visible',
      userId: row.user_id,
      username: row.username,
      isSelf: viewerId === row.user_id,
    };
  }

  /**
   * The members a language board is drawn from (T-844): active accounts whose
   * chosen interface language has this primary subtag. Who may then see them
   * is `predictionHistoryAudience`'s to say, as on every board computed on read.
   */
  membersByLanguage(language: string): Promise<string[]> {
    return this.store.idsByLanguage(language);
  }

  /**
   * `predictionHistoryAccess` for many members at once (T-641): of `userIds`,
   * the active members whose prediction history `viewerId` may read, by id,
   * with their usernames. The same `canView` rule on the same setting, so a
   * month or season board -- which says when a member predicted -- shows
   * exactly the members whose history the viewer could open.
   */
  async predictionHistoryAudience(
    userIds: string[],
    viewerId: string | null,
  ): Promise<Map<string, string>> {
    const visible = new Map<string, string>();
    const rows = await this.store.findByUserIds(userIds);
    // The viewer's friends are read once for the whole set, and only when a
    // member in it has chosen `friends` (T-942): the same `canView`, asked
    // with one query rather than one per member.
    const friends =
      viewerId !== null &&
      rows.some(
        (row) => row.prediction_history_visibility === 'friends' && row.user_id !== viewerId,
      )
        ? new Set(await this.friendships.friendIds(viewerId))
        : new Set<string>();
    for (const row of rows) {
      const areFriends = viewerId !== row.user_id && friends.has(row.user_id);
      if (canView(row.prediction_history_visibility, row.user_id, viewerId, areFriends))
        visible.set(row.user_id, row.username);
    }
    return visible;
  }

  async own(userId: string): Promise<OwnProfile | null> {
    const row = await this.store.findByUserId(userId);
    const account = await this.identity.userById(userId);
    if (row === null || account === null) return null;

    return {
      profile: toPublicProfile(row, await this.following.favouriteTeamNames(userId)),
      account,
      privacy: toPrivacy(row),
      viewing_territory: await this.store.viewingTerritory(userId),
      first_run: await this.store.firstRun(userId),
      ...(await this.store.appearance(userId)),
    };
  }

  // --- the first-run flow (T-620) ----------------------------------------

  firstRun(userId: string): Promise<FirstRunState> {
    return this.store.firstRun(userId);
  }

  /** Finished or dismissed: either way it is not offered again. Idempotent. */
  async completeFirstRun(userId: string): Promise<FirstRunState> {
    await this.store.completeFirstRun(userId);
    return this.store.firstRun(userId);
  }

  async updatePreferences(
    userId: string,
    patch: UpdatePreferencesRequest,
  ): Promise<OwnProfile | null> {
    await this.store.setPreferences(userId, {
      language: patch.preferred_language,
      timezone: patch.timezone,
      theme: patch.theme,
      textSize: patch.text_size,
      contrast: patch.contrast,
      motion: patch.motion,
    });
    return this.own(userId);
  }

  // --- the viewing territory (T-312) -------------------------------------

  territories(): Promise<Territory[]> {
    return this.store.territories();
  }

  viewingTerritory(userId: string): Promise<ViewingTerritory> {
    return this.store.viewingTerritory(userId);
  }

  setViewingTerritory(userId: string, code: string | null): Promise<'set' | 'unknown'> {
    return this.store.setViewingTerritory(userId, code);
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
    if (type === 'fixture') {
      if (favourite === true) return 'favourite_match';
      const state = await this.following.fixtureFollowState(entityId);
      if (state === 'unknown') return 'unknown_entity';
      if (state === 'ended') return 'follow_ended';
    } else if (!(await this.following.entityExists(type, entityId))) {
      return 'unknown_entity';
    }
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
