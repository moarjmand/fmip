import { Inject, Injectable } from '@nestjs/common';
import type { SearchEntityType, SearchResult } from '@fmip/contracts';
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
 * similarity or prefix, best match per entity kept, ranked by score then
 * name. Inactive teams and competitions are left out.
 */
@Injectable()
export class PostgresSearchStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async search(q: string, types: SearchEntityType[], limit: number): Promise<SearchResult[]> {
    const { rows } = await this.pool.query<{
      type: SearchEntityType;
      id: string;
      name: string;
      secondary: string | null;
      matched_on: 'name' | 'alias';
      alias: string | null;
      score: string;
    }>(
      `WITH q AS (SELECT search_key($1) AS key),
       hits AS (
         -- Teams by name, short name or code.
         SELECT 'team'::text AS type, t.id, t.name, co.name AS secondary,
                'name'::text AS matched_on, NULL::text AS alias,
                GREATEST(
                  word_similarity(q.key, search_key(t.name)),
                  CASE WHEN search_key(t.name) LIKE q.key || '%' THEN 1 ELSE 0 END,
                  CASE WHEN t.short_name IS NOT NULL AND search_key(t.short_name) = q.key THEN 1 ELSE 0 END,
                  CASE WHEN t.code IS NOT NULL AND lower(t.code) = q.key THEN 1 ELSE 0 END
                ) AS score
           FROM team t CROSS JOIN q
           LEFT JOIN country co ON co.id = t.country_id
          WHERE t.is_active
         UNION ALL
         -- Competitions by name or short name.
         SELECT 'competition', c.id, c.name, co.name, 'name', NULL,
                GREATEST(
                  word_similarity(q.key, search_key(c.name)),
                  CASE WHEN search_key(c.name) LIKE q.key || '%' THEN 1 ELSE 0 END,
                  CASE WHEN c.short_name IS NOT NULL AND search_key(c.short_name) = q.key THEN 1 ELSE 0 END
                )
           FROM competition c CROSS JOIN q
           LEFT JOIN country co ON co.id = c.country_id
          WHERE c.is_active
         UNION ALL
         -- People by full name or known-as; the current team as the secondary line.
         SELECT 'person', p.id, COALESCE(p.known_as, p.full_name),
                (SELECT t.name FROM player_spell ps JOIN team t ON t.id = ps.team_id
                  WHERE ps.person_id = p.id AND ps.end_date IS NULL
                  ORDER BY ps.start_date DESC LIMIT 1),
                'name', NULL,
                GREATEST(
                  word_similarity(q.key, search_key(p.full_name)),
                  COALESCE(word_similarity(q.key, search_key(p.known_as)), 0),
                  CASE WHEN search_key(p.full_name) LIKE q.key || '%' THEN 1 ELSE 0 END,
                  CASE WHEN p.known_as IS NOT NULL AND search_key(p.known_as) LIKE q.key || '%' THEN 1 ELSE 0 END
                )
           FROM person p CROSS JOIN q
         UNION ALL
         -- Aliases of any kind, each resolved to its entity's canonical name.
         SELECT a.entity_type, a.entity_id,
                CASE a.entity_type
                  WHEN 'team' THEN (SELECT name FROM team WHERE id = a.entity_id)
                  WHEN 'competition' THEN (SELECT name FROM competition WHERE id = a.entity_id)
                  ELSE (SELECT COALESCE(known_as, full_name) FROM person WHERE id = a.entity_id)
                END,
                CASE a.entity_type
                  WHEN 'team' THEN (SELECT co.name FROM team t LEFT JOIN country co ON co.id = t.country_id WHERE t.id = a.entity_id)
                  WHEN 'competition' THEN (SELECT co.name FROM competition c LEFT JOIN country co ON co.id = c.country_id WHERE c.id = a.entity_id)
                  ELSE (SELECT t.name FROM player_spell ps JOIN team t ON t.id = ps.team_id
                         WHERE ps.person_id = a.entity_id AND ps.end_date IS NULL
                         ORDER BY ps.start_date DESC LIMIT 1)
                END,
                'alias', a.alias,
                GREATEST(
                  word_similarity(q.key, search_key(a.alias)),
                  CASE WHEN search_key(a.alias) LIKE q.key || '%' THEN 1 ELSE 0 END
                )
           FROM entity_alias a CROSS JOIN q
       ),
       best AS (
         SELECT DISTINCT ON (type, id) type, id, name, secondary, matched_on, alias, score
           FROM hits
          WHERE score >= $4 AND type = ANY($2::text[]) AND name IS NOT NULL
          ORDER BY type, id, score DESC, matched_on
       )
       SELECT type, id, name, secondary, matched_on, alias, round(score::numeric, 3)::text AS score
         FROM best
        ORDER BY score DESC, name, type
        LIMIT $3`,
      [q, types, limit, MIN_SIMILARITY],
    );
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
}
