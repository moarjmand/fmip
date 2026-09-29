/**
 * `/me/following` on `apps/api` (T-042).
 *
 * Following is a row; favourite is a flag on it. Favourites are pinned first
 * on the scores page and shown on the profile; everything followed feeds the
 * Following views (blueprint 4.1, 7.2).
 */

/**
 * T-945 (D-116): a `fixture` is a match followed. It joins that match's alert
 * audience, is never a favourite, and ends by itself three hours after
 * full-time -- after which `GET /me/following` no longer lists it and a new
 * follow of it is a 409.
 */
export const FOLLOWED_ENTITY_TYPES = ['team', 'competition', 'person', 'fixture'] as const;
export type FollowedEntityType = (typeof FOLLOWED_ENTITY_TYPES)[number];

export interface FollowedEntity {
  entity_type: FollowedEntityType;
  entity_id: string;
  /** The entity's current display name, joined at read time; a match is "Home v Away". */
  name: string;
  favourite: boolean;
  /** ISO 8601. */
  followed_at: string;
}

/** `GET /me/following`, favourites first, then by name. */
export interface FollowingResponse {
  items: FollowedEntity[];
}

/**
 * `PUT /me/following/:entity_type/:entity_id`. Creates the follow if absent;
 * `favourite` sets or clears the pin. Idempotent.
 */
export interface FollowRequest {
  favourite?: boolean;
}

/** The ids a personalised view needs, as `GET /me/favourites` returns them. */
export interface FavouriteIds {
  team_ids: string[];
  competition_ids: string[];
  person_ids: string[];
  /** Everything followed, favourite or not. */
  followed_team_ids: string[];
  followed_competition_ids: string[];
}
