import type { CoverageState, Covered } from './coverage';
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
  id: string;
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
  id: string;
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

/** `GET /viewing?fixture=<id>&fixture=<id>`: the same module for several matches, in the order asked, minus any id that is not a match. */
export interface ViewingBatchResponse {
  generated_at: string;
  territory: ViewingTerritory;
  fixtures: MatchViewing[];
}

// ---------------------------------------------------------------------------
// The editorial desk (T-313, D-069). Until a licence says otherwise, every
// listing and every highlight is a row an editor entered from a public
// schedule, under a source that grants a link and nothing more. Coverage is
// declared first, per season and territory, because a listing without a
// coverage row would be a fact nobody stood behind; and every write is an
// audit row with the editor, the reason and what was there before (rule 10).
// ---------------------------------------------------------------------------
export const VIEWING_MODULES = ['viewing', 'highlights'] as const;
export type ViewingModule = (typeof VIEWING_MODULES)[number];

/** What an editor may declare: covered (what is listed is what there is), partly, or not covered. `delayed` belongs to a feed. */
export const VIEWING_COVERAGE_STATES = ['available', 'limited', 'not_supplied'] as const;
export type ViewingCoverageState = (typeof VIEWING_COVERAGE_STATES)[number];

export interface BroadcasterRequest {
  name: string;
  homepage_url: string | null;
  kind: BroadcasterKind;
}

export interface BroadcasterResponse {
  broadcaster: Broadcaster;
}

/** `GET /admin/viewing/broadcasters`, by name. */
export interface BroadcastersResponse {
  broadcasters: Broadcaster[];
}

export interface ViewingCoverageRecord {
  season_id: string;
  territory: string;
  module: ViewingModule;
  state: CoverageState;
  /** Null exactly when the state is `not_supplied`. */
  source: ViewingSource | null;
  note: string | null;
  updated_at: string;
}

/** `PUT /admin/viewing/coverage`: one declaration, replacing the last for the same season, territory and module. */
export interface ViewingCoverageRequest {
  season_id: string;
  territory: string;
  module: ViewingModule;
  state: ViewingCoverageState;
  /** Why: which schedule, which desk. Required. */
  note: string;
}

/** `GET /admin/viewing/coverage?season=<id>`. */
export interface ViewingCoverageResponse {
  coverage: ViewingCoverageRecord[];
}

/** `POST /admin/fixtures/:id/viewing-options`. */
export interface ViewingOptionRequest {
  territory: string;
  broadcaster_id: string;
  access: ViewingAccess;
  /** The official destination; `http(s)` only. */
  url: string;
}

export interface ViewingOptionResponse {
  option: ViewingOption;
}

/** `PUT /admin/fixtures/:id/highlight`: the official highlight page for a territory; never a player, because the desk holds no rights to one. */
export interface HighlightRequest {
  territory: string;
  url: string;
}

/** `POST .../remove`: taking a listing or a highlight down needs a reason, which the audit row keeps. */
export interface ViewingRemovalRequest {
  reason: string;
}
