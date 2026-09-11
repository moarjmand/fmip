import type { SearchEntityType, SearchResult } from '@fmip/contracts';

/**
 * The search page's pure helpers (T-038): the query the URL carries, the
 * API query, where a result leads and how its kind reads.
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
