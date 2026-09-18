import type { Covered } from './coverage';
import type { ViewingTerritory } from './territory';

/**
 * Watch and highlights (blueprint 11, T-311): where a match can be watched
 * in the viewer's territory, and the official highlight afterwards.
 *
 * Every shape here is per territory, because the correct answer differs
 * between countries, and every shape names its source and what that source
 * grants, because a surface shows no more than it may (D-061's rights
 * model). "Not supplied" and "not available" are different sentences: the
 * `Covered` envelope carries the first and an empty list under `available`
 * carries the second, and only a source that covers the territory can say it.
 */
export const VIEWING_RIGHTS = ['link', 'thumbnail', 'embed'] as const;
/** What a source lets us show, in ascending order: a link, a thumbnail beside it, a player on our page. */
export type ViewingRights = (typeof VIEWING_RIGHTS)[number];

export const VIEWING_ACCESS = ['free', 'registration', 'subscription', 'pay_per_view'] as const;
export type ViewingAccess = (typeof VIEWING_ACCESS)[number];

export const BROADCASTER_KINDS = ['tv', 'streaming', 'radio'] as const;
export type BroadcasterKind = (typeof BROADCASTER_KINDS)[number];

export interface ViewingSource {
  id: string;
  name: string;
  rights: ViewingRights;
}

export interface Broadcaster {
  id: string;
  name: string;
  homepage_url: string | null;
  kind: BroadcasterKind;
}

/** One listing: this service, this access, this official destination, in this territory. */
export interface ViewingOption {
  broadcaster: Broadcaster;
  access: ViewingAccess;
  /** The official destination. The surface sends the viewer there; nothing is hosted. */
  url: string;
  /** ISO 3166-1 alpha-2 of the territory the listing is for. */
  territory: string;
  source: ViewingSource;
  /** When the source last confirmed it (rule 4). */
  last_updated_at: string;
}

/**
 * The official highlight for a match in a territory: an embed where the
 * source grants one, else the official page. `url` is always the page, so a
 * dead player still has somewhere to send the viewer.
 */
export interface Highlight {
  kind: 'embed' | 'official_page';
  url: string;
  /** Present exactly when `kind` is `embed`; never from a source that grants less. */
  embed_url: string | null;
  /** Never from a source that grants a link only. */
  thumbnail_url: string | null;
  territory: string;
  source: ViewingSource;
  last_updated_at: string;
}

/**
 * The viewing module for one match (T-311; rendered by T-314 in four places).
 *
 * `territory` is the viewer's chosen one (T-312); `not_chosen` means the
 * surface asks, and both modules are `not_supplied` because there is no
 * territory to answer for. Otherwise each module is `not_supplied` when no
 * source covers the match's season in that territory, and `available` with
 * an empty list when a source that does cover it listed nothing -- the one
 * case in which "not available in your territory" is a fact and not a guess.
 */
export interface MatchViewing {
  fixture_id: string;
  territory: ViewingTerritory;
  options: Covered<ViewingOption[]>;
  highlights: Covered<Highlight[]>;
}
