import type { ViewingTerritory } from './territory';
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

/**
 * The colour theme a member chose (T-602, D-089): `system` follows the
 * device's light or dark setting, which is also what a guest gets until they
 * choose.
 */
export const THEME_PREFERENCES = ['light', 'dark', 'system'] as const;
export type ThemePreference = (typeof THEME_PREFERENCES)[number];

/**
 * The accessibility preferences (blueprint 2.2, T-621), kept like the theme.
 * Text size scales every rem-based size on the page; `default` is the
 * browser's own. Contrast `more` raises every text role to WCAG AAA (7:1);
 * `system` follows the device's `prefers-contrast`. Motion `reduce` stops
 * animations and transitions whatever the device says; `system` follows its
 * `prefers-reduced-motion`. The first value of each is what an account that
 * never chose holds.
 */
export const TEXT_SIZE_PREFERENCES = ['default', 'large', 'larger'] as const;
export type TextSizePreference = (typeof TEXT_SIZE_PREFERENCES)[number];

export const CONTRAST_PREFERENCES = ['system', 'standard', 'more'] as const;
export type ContrastPreference = (typeof CONTRAST_PREFERENCES)[number];

export const MOTION_PREFERENCES = ['system', 'reduce'] as const;
export type MotionPreference = (typeof MOTION_PREFERENCES)[number];

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
  /** Where the member chose to be shown viewing options for (T-312); `not_chosen` until they do. */
  viewing_territory: ViewingTerritory;
  /** Whether the first-run flow has been finished or dismissed (T-620). */
  first_run: FirstRunState;
  /** The colour theme the member chose (T-602); `system` until they choose. */
  theme: ThemePreference;
  /** Text size (T-621); `default` until they choose. */
  text_size: TextSizePreference;
  /** Contrast (T-621); `system` (the device's) until they choose. */
  contrast: ContrastPreference;
  /** Motion (T-621); `system` (the device's) until they choose. */
  motion: MotionPreference;
}

/**
 * The first-run flow (blueprint 2.3 and 7.1, T-620): language, territory,
 * time zone and favourite teams, offered once. `pending` until the member
 * finishes or dismisses it; `done` keeps the first moment and never moves.
 */
export type FirstRunState = { state: 'pending' } | { state: 'done'; at: string };

/** `GET`/`PUT /me/first-run`. `PUT` takes no body: it records that the flow is over. */
export interface FirstRunResponse {
  first_run: FirstRunState;
}

/**
 * `PATCH /me/preferences` (T-620): the language and time zone chosen at
 * registration, changed afterwards, and the colour theme (T-602), and text size,
 * contrast and motion (T-621). Only the fields present change; each is
 * validated as registration validates it (a BCP 47 tag, an IANA zone), the
 * others as one of their own list.
 */
export interface UpdatePreferencesRequest {
  preferred_language?: string;
  timezone?: string;
  theme?: ThemePreference;
  text_size?: TextSizePreference;
  contrast?: ContrastPreference;
  motion?: MotionPreference;
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
