/**
 * Entity search (blueprint 5, T-038): teams, competitions and people by
 * name, accent-folded and trigram-matched, and by alias — the spellings,
 * transliterations and abbreviations a name does not carry itself.
 */

export const SEARCH_ENTITY_TYPES = ['team', 'competition', 'person'] as const;
export type SearchEntityType = (typeof SEARCH_ENTITY_TYPES)[number];

export interface SearchResult {
  type: SearchEntityType;
  id: string;
  /** The canonical name, never the alias. */
  name: string;
  /** Country for a team or competition, current team for a person; null when unknown. */
  secondary: string | null;
  matched_on: 'name' | 'alias';
  /** The alias that matched, when one did. */
  alias: string | null;
  /** 0–1: how well the query matched. */
  score: number;
}

/** `GET /search?q=&types=team,person&limit=`. */
export interface SearchResponse {
  query: string;
  types: SearchEntityType[];
  results: SearchResult[];
}
