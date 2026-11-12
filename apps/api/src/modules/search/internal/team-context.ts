import type { SearchResult, SearchTeamContext } from '@fmip/contracts';

/**
 * Each team result's context (T-1803, D-401): its domestic league and its
 * home ground, read in one query for the whole page of results
 * (`PostgresSearchStore.teamContexts`), so four teams called "Arsenal" can be
 * told apart. A team the query returned nothing for has neither on record.
 */

/** The ids of the team results, the ones a context is read for. */
export function teamIds(results: readonly SearchResult[]): string[] {
  return results.filter((r) => r.type === 'team').map((r) => r.id);
}

const NONE: SearchTeamContext = { league: null, ground: null };

/** The results with each team's context; a competition or a person is left as it is. */
export function withTeamContexts(
  results: readonly SearchResult[],
  contexts: ReadonlyMap<string, SearchTeamContext>,
): SearchResult[] {
  return results.map((r) =>
    r.type === 'team' ? { ...r, team_context: contexts.get(r.id.toLowerCase()) ?? NONE } : r,
  );
}
