import type {
  GroupSearchResult,
  SearchEntityType,
  SearchResult,
  SearchType,
} from '@fmip/contracts';
import { SEARCH_COMMUNITY_TYPES, SEARCH_ENTITY_TYPES } from '@fmip/contracts';
import type { MessageKey } from '@/i18n/messages';

/**
 * The search page's pure helpers (T-038, T-642): the query the URL carries,
 * the API queries, where a result leads, how its kind reads, and the sections
 * the page is made of.
 */

type SearchParams = Record<string, string | string[] | undefined>;

export const MIN_QUERY_LENGTH = 2;

/** `?q=`, whitespace collapsed; empty when absent. */
export function readSearchTerm(params: SearchParams): string {
  const raw = Array.isArray(params.q) ? params.q[0] : params.q;
  return (raw ?? '').trim().replace(/\s+/g, ' ');
}

/** The `GET /search` query string, or null when the term is too short to ask. */
export function apiQuery(term: string, limit = 20): string | null {
  if (term.length < MIN_QUERY_LENGTH) return null;
  return `q=${encodeURIComponent(term)}&limit=${limit}`;
}

export function resultHref(locale: string, result: Pick<SearchResult, 'type' | 'id'>): string {
  const path: Record<SearchEntityType, string> = {
    team: 'team',
    competition: 'competition',
    person: 'player',
  };
  return `/${locale}/${path[result.type]}/${encodeURIComponent(result.id)}`;
}

export const TYPE_LABEL: Record<SearchEntityType, string> = {
  team: 'Team',
  competition: 'Competition',
  person: 'Player',
};

/** "also known as The Zebras" when an alias matched, else null. */
export function matchNote(result: Pick<SearchResult, 'matched_on' | 'alias'>): string | null {
  return result.matched_on === 'alias' && result.alias !== null
    ? `also known as ${result.alias}`
    : null;
}

// ---------------------------------------------------------------------------
// T-642: stories, groups and members, each in its own section.
// ---------------------------------------------------------------------------

/** How many of each community kind the page lists. */
export const COMMUNITY_LIMIT = 10;

/**
 * The `GET /search` query for the kinds members and publishers make, or null
 * when the term is too short. The catalog's kinds come from `/ask` (T-421),
 * so they are not asked for twice.
 */
export function communityQuery(term: string, limit = COMMUNITY_LIMIT): string | null {
  if (term.length < MIN_QUERY_LENGTH) return null;
  return `q=${encodeURIComponent(term)}&types=${SEARCH_COMMUNITY_TYPES.join(',')}&limit=${limit}`;
}

/**
 * The catalog sections the page shows: the kinds the question was read as
 * asking for, or all three when it named none (or was not read at all).
 */
export function entitySections(asked: readonly SearchEntityType[] | null): SearchEntityType[] {
  return asked === null || asked.length === 0
    ? [...SEARCH_ENTITY_TYPES]
    : SEARCH_ENTITY_TYPES.filter((type) => asked.includes(type));
}

/** The catalog rows of one kind, keeping the search's score order. */
export function ofType(results: readonly SearchResult[], type: SearchEntityType): SearchResult[] {
  return results.filter((result) => result.type === type);
}

export const SECTION_TITLE_KEY: Record<SearchType, MessageKey> = {
  team: 'search.section.team',
  competition: 'search.section.competition',
  person: 'search.section.person',
  story: 'search.section.story',
  group: 'search.section.group',
  member: 'search.section.member',
};

/** Each section's own sentence for nothing found; the community ones say who is never listed. */
export const SECTION_EMPTY_KEY: Record<SearchType, MessageKey> = {
  team: 'search.empty.team',
  competition: 'search.empty.competition',
  person: 'search.empty.person',
  story: 'search.empty.story',
  group: 'search.empty.group',
  member: 'search.empty.member',
};

export const GROUP_VISIBILITY_KEY: Record<GroupSearchResult['visibility'], MessageKey> = {
  public: 'search.group.public',
  discoverable: 'search.group.discoverable',
};

export function groupHref(locale: string, slug: string): string {
  return `/${locale}/groups/${encodeURIComponent(slug)}`;
}

export function memberHref(locale: string, username: string): string {
  return `/${locale}/u/${encodeURIComponent(username)}`;
}
