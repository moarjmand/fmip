import type { AuthUser } from './identity';

/**
 * `/profiles/*` and `/me/*` on `apps/api` (T-041).
 *
 * Privacy is enforced by the API, not by the page: a profile the viewer may
 * not see is never sent. What is always public is the username and display
 * name, because a public leaderboard shows them (blueprint 7.2).
 */

export const PRIVACY_VISIBILITIES = ['public', 'friends', 'private'] as const;
export type PrivacyVisibility = (typeof PRIVACY_VISIBILITIES)[number];

export interface PrivacySettings {
  profile_visibility: PrivacyVisibility;
  prediction_history_visibility: PrivacyVisibility;
}

/** What a viewer who is allowed to see the profile receives. */
export interface PublicProfile {
  username: string;
  display_name: string;
  bio: string | null;
  avatar_url: string | null;
  country_id: string;
  /** ISO 8601 date of registration. */
  member_since: string;
  /** Names of the teams the member has pinned as favourites (blueprint 7.2). */
  favourite_teams: string[];
}

/** `GET /profiles/:username`. */
export type ProfileView =
  | { kind: 'visible'; profile: PublicProfile; is_self: boolean }
  | {
      kind: 'restricted';
      username: string;
      display_name: string;
      visibility: Exclude<PrivacyVisibility, 'public'>;
    };

/** `GET /me/profile`: everything the owner sees about themselves. */
export interface OwnProfile {
  profile: PublicProfile;
  account: AuthUser;
  privacy: PrivacySettings;
}

/** `PATCH /me/profile`. Only the fields present change; `null` clears. */
export interface UpdateProfileRequest {
  display_name?: string;
  bio?: string | null;
  avatar_url?: string | null;
}

/** `PATCH /me/privacy`. Only the fields present change. */
export interface UpdatePrivacyRequest {
  profile_visibility?: PrivacyVisibility;
  prediction_history_visibility?: PrivacyVisibility;
}
