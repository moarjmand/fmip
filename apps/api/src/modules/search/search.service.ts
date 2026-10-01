import { Injectable } from '@nestjs/common';
import {
  SEARCH_ENTITY_TYPES,
  type SearchEntityType,
  type SearchResponse,
  type SearchType,
} from '@fmip/contracts';
import { PostgresCommunitySearchStore } from './internal/community-search-store';
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

const isEntityType = (type: SearchType): type is SearchEntityType =>
  (SEARCH_ENTITY_TYPES as readonly string[]).includes(type);

/**
 * The search boundary (02-architecture.md): teams, competitions and people
 * by name or alias (T-038, D-039), and news stories, findable groups and
 * public members (T-642, D-087). No index of its own: Postgres trigrams over
 * the tables themselves are the index.
 *
 * `viewerId` matters to members only -- a block hides both sides from each
 * other -- and is null for a guest. A kind not in `types` is not queried and
 * comes back `null`.
 */
@Injectable()
export class SearchService {
  constructor(
    private readonly store: PostgresSearchStore,
    private readonly community: PostgresCommunitySearchStore,
  ) {}

  /** `locale` is the reader's: stories they are not shown are not found (D-178). */
  async search(
    query: SearchQuery,
    viewerId: string | null = null,
    locale: string | null = null,
  ): Promise<SearchResponse> {
    const entityTypes = query.types.filter(isEntityType);
    const wants = (type: SearchType) => query.types.includes(type);
    const [results, stories, groups, members] = await Promise.all([
      entityTypes.length === 0
        ? Promise.resolve([])
        : this.store.search(query.q, entityTypes, query.limit),
      wants('story') ? this.community.stories(query.q, query.limit, locale) : null,
      wants('group') ? this.community.groups(query.q, query.limit) : null,
      wants('member') ? this.community.members(query.q, viewerId, query.limit) : null,
    ]);
    return { query: query.q, types: query.types, results, stories, groups, members };
  }
}
