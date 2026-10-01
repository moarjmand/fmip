/**
 * Search (blueprint 2.2 and 5).
 *
 * Entity search (T-038): teams, competitions and people by name,
 * accent-folded and trigram-matched, and by alias — the spellings,
 * transliterations and abbreviations a name does not carry itself.
 *
 * T-642 widens it to what members and publishers make (D-087): news stories
 * by headline, groups that can be found, and members whose profile is public.
 * A private or friends-only profile, and an invite-only group, is never a
 * result.
 */
import type { GroupVisibility } from './groups';

/** The catalog's kinds. `/ask` reads its intents against these alone. */
export const SEARCH_ENTITY_TYPES = ['team', 'competition', 'person'] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

/** The kinds members and publishers make (T-642). */
export const SEARCH_COMMUNITY_TYPES = ['story', 'group', 'member'] as const;
export type SearchCommunityType = (typeof SEARCH_COMMUNITY_TYPES)[number];

/** Every kind `GET /search?types=` accepts, in the order a page lists them. */
export const SEARCH_TYPES = [...SEARCH_ENTITY_TYPES, ...SEARCH_COMMUNITY_TYPES] as const;
export type SearchType = (typeof SEARCH_TYPES)[number];

export interface SearchResult {
  type: SearchEntityType;
  id: string;
  /**
   * The canonical name, never the alias that matched -- or, with `?locale=`,
   * the name in that language where one is written (T-1312).
   */
  name: string;
  /** Country for a team or competition, current team for a person; null when unknown. */
  secondary: string | null;
  matched_on: 'name' | 'alias';
  /** The alias that matched, when one did. */
  alias: string | null;
  /** 0–1: how well the query matched. */
  score: number;
}

/**
 * A news story found by its headline (D-061: the product holds a headline and
 * a link, never an article). The headline is the promoted original's, in the
 * language whose headline matched, from a source that still grants it.
 */
export interface StorySearchResult {
  story_id: string;
  headline: string;
  language: string;
  source_name: string;
  /** The publisher's own page. */
  url: string;
  published_at: string;
  score: number;
}

/** A group that can be found: public or discoverable, never invite-only. */
export interface GroupSearchResult {
  slug: string;
  name: string;
  visibility: Exclude<GroupVisibility, 'invite_only'>;
  /** Public even for a discoverable group (see `GroupSummary.member_count`). */
  member_count: number;
  score: number;
}

/**
 * A member whose profile is public, whose account is active, and who has not
 * blocked the viewer nor been blocked by them.
 */
export interface MemberSearchResult {
  username: string;
  display_name: string;
  score: number;
}

/**
 * `GET /search?q=&types=team,person,story&limit=`.
 *
 * `results` holds the catalog's kinds, ranked together. Each community kind
 * has its own list, capped at `limit` on its own, and is `null` when it was
 * not asked for -- an empty list means it was searched and nothing matched.
 */
export interface SearchResponse {
  query: string;
  types: SearchType[];
  results: SearchResult[];
  stories: StorySearchResult[] | null;
  groups: GroupSearchResult[] | null;
  members: MemberSearchResult[] | null;
}
