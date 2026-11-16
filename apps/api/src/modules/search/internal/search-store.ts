import { Inject, Injectable } from '@nestjs/common';
import type { SearchEntityType, SearchResult, SearchTeamContext } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/**
 * How close a query must come to a name or alias to count (pg_trgm
 * `word_similarity`, 0–1). A prefix match, an exact alias, short name or
 * code scores 1 regardless.
 */
export const MIN_SIMILARITY = 0.45;

/**
 * SQL for entity search (D-039): names and aliases folded through
 * `search_key()` (lower-cased, accents removed), matched by trigram word
 * similarity or prefix, best match per entity kept, ranked by score, then a
 * name or alias that is exactly the query (T-1481: "liverpool" put AFC
 * Liverpool and City of Liverpool, both scoring 1 on the word, before
 * Liverpool), then name. Inactive teams and competitions are left out.
 *
 * T-1842: every branch first narrows its table by the trigram GIN indexes
 * (`<%`, word similarity at {@link MIN_SIMILARITY}, set for this transaction
 * only, and the prefix `LIKE`), so a search reads the few rows that can match
 * instead of scoring all 111,000 people and 57,000 aliases (about 2.5 s on
 * the server before, tens of milliseconds after). The narrowing keeps exactly
 * the rows the score keeps, and the secondary line (country, current club) is
 * read for the page of results only.
 */
@Injectable()
export class PostgresSearchStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async search(q: string, types: SearchEntityType[], limit: number): Promise<SearchResult[]> {
    const client = await this.pool.connect();
    let rows: {
      type: SearchEntityType;
      id: string;
      name: string;
      secondary: string | null;
      matched_on: 'name' | 'alias';
      alias: string | null;
      score: string;
    }[];
    try {
      await client.query('BEGIN READ ONLY');
      // `<%` matches at this threshold; SET LOCAL's scope ends with the transaction.
      await client.query(`SELECT set_config('pg_trgm.word_similarity_threshold', $1, true)`, [
        String(MIN_SIMILARITY),
      ]);
      ({ rows } = await client.query(SEARCH_SQL, [q, types, limit, MIN_SIMILARITY]));
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return rows.map((r) => ({
      type: r.type,
      id: r.id,
      name: r.name,
      secondary: r.secondary,
      matched_on: r.matched_on,
      alias: r.alias,
      score: Number(r.score),
    }));
  }

  /**
   * What tells each team apart from a namesake (T-1803, D-401), by team id
   * (lower-cased): the domestic league it has a match in this season (a
   * current season, top tier first, then the name), and its home ground --
   * the one recorded, else the ground most of its home matches in a current
   * season name, neutral and cancelled matches left out (D-209's rule, as the
   * team page reads it). One query for every team on the page of results.
   */
  async teamContexts(ids: readonly string[]): Promise<Map<string, SearchTeamContext>> {
    if (ids.length === 0) return new Map();
    const { rows } = await this.pool.query<{
      id: string;
      league_id: string | null;
      league_name: string | null;
      ground_id: string | null;
      ground_name: string | null;
      ground_city: string | null;
    }>(
      `SELECT t.id, lg.id AS league_id, lg.name AS league_name,
              g.id AS ground_id, g.name AS ground_name, g.city AS ground_city
         FROM team t
         LEFT JOIN LATERAL (
           SELECT c.id, c.name
             FROM fixture f
             JOIN fixture_participant p ON p.fixture_id = f.id AND p.team_id = t.id
             JOIN season se ON se.id = f.season_id AND se.is_current
             JOIN competition c ON c.id = se.competition_id
            WHERE c.kind = 'league' AND c.scope = 'domestic'
            ORDER BY c.tier NULLS LAST, c.name, c.id
            LIMIT 1
         ) lg ON TRUE
         LEFT JOIN LATERAL (
           SELECT id, name, city FROM (
             SELECT 0 AS rank, v.id, v.name, v.city, 0::bigint AS matches
               FROM venue v
              WHERE v.id = t.home_venue_id
             UNION ALL
             SELECT 1, v.id, v.name, v.city, count(*)
               FROM fixture f
               JOIN fixture_participant p
                 ON p.fixture_id = f.id AND p.side = 'home' AND p.team_id = t.id
               JOIN season se ON se.id = f.season_id AND se.is_current
               JOIN venue v ON v.id = f.venue_id
              WHERE NOT f.is_neutral_venue AND f.status <> 'cancelled'
              GROUP BY v.id, v.name, v.city
           ) grounds
            ORDER BY rank, matches DESC, name, id
            LIMIT 1
         ) g ON TRUE
        WHERE t.id = ANY($1::uuid[])`,
      [ids],
    );
    return new Map(
      rows.map((r) => [
        r.id.toLowerCase(),
        {
          league:
            r.league_id !== null && r.league_name !== null
              ? { id: r.league_id, name: r.league_name }
              : null,
          ground:
            r.ground_id !== null && r.ground_name !== null
              ? { id: r.ground_id, name: r.ground_name, city: r.ground_city }
              : null,
        },
      ]),
    );
  }
}

/**
 * `$1` the query, `$2` the kinds wanted, `$3` the limit, `$4` the threshold.
 * `search_key($1)` is written out in each branch, not taken from a CTE, so
 * the planner sees a constant and can use the indexes on `search_key(...)`.
 */
const SEARCH_SQL = `
  WITH hits AS (
    -- Teams by name, short name or code.
    SELECT 'team'::text AS type, t.id, t.name,
           'name'::text AS matched_on, NULL::text AS alias,
           GREATEST(
             word_similarity(search_key($1), search_key(t.name)),
             CASE WHEN search_key(t.name) LIKE search_key($1) || '%' THEN 1 ELSE 0 END,
             CASE WHEN t.short_name IS NOT NULL AND search_key(t.short_name) = search_key($1) THEN 1 ELSE 0 END,
             CASE WHEN t.code IS NOT NULL AND lower(t.code) = search_key($1) THEN 1 ELSE 0 END
           ) AS score,
           search_key(t.name) = search_key($1) AS exact
      FROM team t
     WHERE 'team' = ANY($2::text[]) AND t.is_active
       AND (search_key($1) <% search_key(t.name)
            OR search_key(t.name) LIKE search_key($1) || '%'
            OR (t.short_name IS NOT NULL AND search_key(t.short_name) = search_key($1))
            OR (t.code IS NOT NULL AND lower(t.code) = search_key($1)))
    UNION ALL
    -- Competitions by name or short name.
    SELECT 'competition', c.id, c.name, 'name', NULL,
           GREATEST(
             word_similarity(search_key($1), search_key(c.name)),
             CASE WHEN search_key(c.name) LIKE search_key($1) || '%' THEN 1 ELSE 0 END,
             CASE WHEN c.short_name IS NOT NULL AND search_key(c.short_name) = search_key($1) THEN 1 ELSE 0 END
           ),
           search_key(c.name) = search_key($1)
      FROM competition c
     WHERE 'competition' = ANY($2::text[]) AND c.is_active
    UNION ALL
    -- People by full name or known-as.
    SELECT 'person', p.id, COALESCE(p.known_as, p.full_name), 'name', NULL,
           GREATEST(
             word_similarity(search_key($1), search_key(p.full_name)),
             COALESCE(word_similarity(search_key($1), search_key(p.known_as)), 0),
             CASE WHEN search_key(p.full_name) LIKE search_key($1) || '%' THEN 1 ELSE 0 END,
             CASE WHEN p.known_as IS NOT NULL AND search_key(p.known_as) LIKE search_key($1) || '%' THEN 1 ELSE 0 END
           ),
           search_key(p.full_name) = search_key($1) OR COALESCE(search_key(p.known_as) = search_key($1), false)
      FROM person p
     WHERE 'person' = ANY($2::text[])
       AND (search_key($1) <% search_key(p.full_name)
            OR search_key(p.full_name) LIKE search_key($1) || '%'
            OR search_key($1) <% search_key(p.known_as)
            OR search_key(p.known_as) LIKE search_key($1) || '%')
    UNION ALL
    -- Aliases of any kind, each resolved to its entity's canonical name.
    SELECT a.entity_type, a.entity_id,
           CASE a.entity_type
             WHEN 'team' THEN (SELECT name FROM team WHERE id = a.entity_id)
             WHEN 'competition' THEN (SELECT name FROM competition WHERE id = a.entity_id)
             ELSE (SELECT COALESCE(known_as, full_name) FROM person WHERE id = a.entity_id)
           END,
           'alias', a.alias,
           GREATEST(
             word_similarity(search_key($1), search_key(a.alias)),
             CASE WHEN search_key(a.alias) LIKE search_key($1) || '%' THEN 1 ELSE 0 END
           ),
           search_key(a.alias) = search_key($1)
      FROM entity_alias a
     WHERE a.entity_type = ANY($2::text[])
       AND (search_key($1) <% search_key(a.alias)
            OR search_key(a.alias) LIKE search_key($1) || '%')
  ),
  best AS (
    SELECT DISTINCT ON (type, id) type, id, name, matched_on, alias, score, exact
      FROM hits
     WHERE score >= $4 AND name IS NOT NULL
     ORDER BY type, id, score DESC, exact DESC, matched_on
  ),
  page AS (
    SELECT * FROM best
     ORDER BY round(score::numeric, 3) DESC, exact DESC, name, type
     LIMIT $3
  )
  SELECT type, id, name,
         CASE type
           WHEN 'team' THEN (SELECT co.name FROM team t JOIN country co ON co.id = t.country_id WHERE t.id = page.id)
           WHEN 'competition' THEN (SELECT co.name FROM competition c JOIN country co ON co.id = c.country_id WHERE c.id = page.id)
           ELSE (SELECT t.name FROM player_spell ps JOIN team t ON t.id = ps.team_id
                  WHERE ps.person_id = page.id AND ps.end_date IS NULL
                  ORDER BY ps.start_date DESC LIMIT 1)
         END AS secondary,
         matched_on, alias, round(score::numeric, 3)::text AS score
    FROM page
   ORDER BY round(page.score::numeric, 3) DESC, page.exact DESC, page.name, page.type`;
