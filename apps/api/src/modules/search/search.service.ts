import { Injectable } from '@nestjs/common';
import type { SearchResponse } from '@fmip/contracts';
import { type SearchQuery } from './internal/search-query';
import { PostgresSearchStore } from './internal/search-store';

// The module's public surface. Other modules import from this file only.
export {
  DEFAULT_LIMIT,
  MAX_LIMIT,
  QUERY_MAX_LENGTH,
  QUERY_MIN_LENGTH,
  normaliseQuery,
  parseSearchQuery,
  type SearchQuery,
} from './internal/search-query';
export { MIN_SIMILARITY } from './internal/search-store';

/**
 * The search boundary (02-architecture.md, T-038): teams, competitions and
 * people by name or alias (D-039). No index of its own yet: Postgres
 * trigrams over the catalog and the alias table are the index.
 */
@Injectable()
export class SearchService {
  constructor(private readonly store: PostgresSearchStore) {}

  async search(query: SearchQuery): Promise<SearchResponse> {
    return {
      query: query.q,
      types: query.types,
      results: await this.store.search(query.q, query.types, query.limit),
    };
  }
}
