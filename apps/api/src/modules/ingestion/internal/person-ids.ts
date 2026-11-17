/**
 * Every provider id a person holds, for the jobs that ask the provider about
 * one person (T-1866).
 *
 * `provider_mapping` is unique on (provider, external_id, entity_type) only,
 * so one person may hold several of a provider's ids: a duplicate merged into
 * the person that survives keeps its mapping (T-1863). Each per-person job
 * asks by every one of them, in the id space it asks about -- a player's
 * profile, seasons, career and transfers by player ids; a `coach:` id is
 * another space (D-230) and is never sent to a player endpoint.
 *
 * The lowest id comes first, as `min(external_id)` chose before: a person with
 * one id is asked exactly as before. Each extra id is one extra request, so a
 * job counts a person's ids against its allowance and never starts a person
 * whose ids do not fit; a person's ids are asked in one go, so one answer
 * never replaces another's rows alone.
 */

/** A per-person ask: the provider id asked first, and any more the person holds. */
export interface PersonExternalIds {
  /** The lowest of the person's ids in the job's id space. */
  externalId: string;
  /** The person's other ids in that space, lowest first; absent when there are none. */
  moreExternalIds?: string[];
}

/**
 * SQL: a `CROSS JOIN LATERAL` naming `m.external_ids`, every player id of the
 * person in `personColumn`, lowest first, for the provider in `$1`; `NULL`
 * when the person holds none.
 */
export function playerIdsLateral(personColumn: string): string {
  return `CROSS JOIN LATERAL (
    SELECT array_agg(pm.external_id ORDER BY pm.external_id) AS external_ids
      FROM provider_mapping pm
     WHERE pm.internal_id = ${personColumn} AND pm.entity_type = 'person' AND pm.provider = $1
       AND pm.external_id NOT LIKE 'coach:%') m`;
}

/** The ask's ids from the lowest-first list the SQL gave; one id reads as before. */
export function personExternalIds(ids: string[]): PersonExternalIds {
  const [first, ...more] = ids;
  if (first === undefined) throw new Error('a person ask needs at least one provider id');
  return more.length > 0 ? { externalId: first, moreExternalIds: more } : { externalId: first };
}

/** Every id to ask, the lowest first. */
export function everyExternalId(ask: PersonExternalIds): string[] {
  return [ask.externalId, ...(ask.moreExternalIds ?? [])];
}

/**
 * The asks whose ids together fit in `allowance` requests, in order: one that
 * does not fit in what is left waits for a later run, and the next that does
 * is kept, so a person with several ids never holds up the rest. `deferred`
 * counts the asks left out.
 */
export function asksWithin<T extends PersonExternalIds>(
  asks: T[],
  allowance: number,
): { asks: T[]; requests: number; deferred: number } {
  const kept: T[] = [];
  let requests = 0;
  for (const ask of asks) {
    const cost = everyExternalId(ask).length;
    if (requests + cost > allowance) continue;
    kept.push(ask);
    requests += cost;
  }
  return { asks: kept, requests, deferred: asks.length - kept.length };
}
