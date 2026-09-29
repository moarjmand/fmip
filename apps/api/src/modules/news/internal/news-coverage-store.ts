import { Inject, Injectable } from '@nestjs/common';
import type { CompetitionNewsCoverage } from '@fmip/contracts';
import type { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/**
 * News coverage per competition (T-1010, D-129): for each competition, the
 * carried sources -- not dropped -- with a report linked to it whose first
 * publication falls inside the window, the stories each linked, and the
 * distinct stories together. Read from the links the clustering already
 * wrote (`article_entity`, by UUID, rule 1); nothing is inferred from a team
 * link, because "about this competition" is the competition link's claim.
 */
@Injectable()
export class PostgresNewsCoverageStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Coverage for the given competitions, or every competition with a link
   * when `ids` is `null`. A competition nothing covers is absent from the map;
   * `empty` gives its zero.
   */
  async coverage(
    ids: readonly string[] | null,
    windowDays: number,
    floor: number,
  ): Promise<Map<string, CompetitionNewsCoverage>> {
    const { rows } = await this.pool.query<{
      competition_id: string;
      source_id: string | null;
      source_name: string | null;
      stories: number;
    }>(
      `WITH linked AS (
         SELECT ae.entity_id AS competition_id, a.source_id, s.name AS source_name, a.story_id
           FROM article_entity ae
           JOIN article a ON a.id = ae.article_id
           JOIN news_source s ON s.id = a.source_id AND s.dropped_at IS NULL
          WHERE ae.entity_type = 'competition'
            AND ($1::uuid[] IS NULL OR ae.entity_id = ANY($1::uuid[]))
            AND (SELECT min(v.published_at) FROM article_version v WHERE v.article_id = a.id)
                >= now() - make_interval(days => $2::int)
       )
       SELECT competition_id, source_id, max(source_name) AS source_name,
              count(DISTINCT story_id)::int AS stories
         FROM linked
        GROUP BY GROUPING SETS ((competition_id, source_id), (competition_id))`,
      [ids, windowDays],
    );
    const out = new Map<string, CompetitionNewsCoverage>();
    const of = (id: string): CompetitionNewsCoverage => {
      let found = out.get(id);
      if (found === undefined) {
        found = PostgresNewsCoverageStore.empty(windowDays, floor);
        out.set(id, found);
      }
      return found;
    };
    for (const row of rows) {
      const coverage = of(row.competition_id);
      if (row.source_id === null) coverage.stories = row.stories;
      else
        coverage.sources.push({
          id: row.source_id,
          name: row.source_name ?? '',
          stories: row.stories,
        });
    }
    for (const coverage of out.values()) {
      coverage.sources.sort((a, b) => b.stories - a.stories || a.name.localeCompare(b.name));
    }
    return out;
  }

  static empty(windowDays: number, floor: number): CompetitionNewsCoverage {
    return { window_days: windowDays, floor, stories: 0, sources: [] };
  }

  /** Every active competition, by id and name, for the console's report. */
  async activeCompetitions(): Promise<{ id: string; name: string }[]> {
    const { rows } = await this.pool.query<{ id: string; name: string }>(
      `SELECT id, name FROM competition WHERE is_active ORDER BY tier NULLS LAST, name, id`,
    );
    return rows;
  }

  /** Sources carried now: not dropped. */
  async carriedSources(): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM news_source WHERE dropped_at IS NULL`,
    );
    return rows[0]?.n ?? 0;
  }
}
