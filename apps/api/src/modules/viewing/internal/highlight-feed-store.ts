import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { FeedCandidate } from './highlight-feed';

/** The feed's `viewing_source` row, fixed by id in migration `1765843000000` (rule 1). */
export const HIGHLIGHTLY_FEED_SOURCE = '00000000-0000-4000-8000-000000000902';

export interface FeedClip {
  url: string;
  title: string;
  publisher: string | null;
  allowed: string[];
  blocked: string[];
}

/**
 * The highlights feed's SQL (T-1366, D-184): the finished matches inside the
 * window with what the feed would need to place a clip on them, and the one
 * write -- a clip for a match, once. A match that already has a row (kept or
 * withdrawn by an editor) is never written again, so a removal stays removed.
 */
@Injectable()
export class PostgresHighlightFeedStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async candidates(now: Date, windowHours: number): Promise<FeedCandidate[]> {
    const { rows } = await this.pool.query<{
      fixture_id: string;
      kickoff_at: Date;
      competition_id: string;
      league_external_id: string | null;
      home_team_id: string | null;
      away_team_id: string | null;
      held: boolean;
    }>(
      `SELECT f.id AS fixture_id, f.kickoff_at, s.competition_id,
              m.external_id AS league_external_id,
              h.team_id AS home_team_id, a.team_id AS away_team_id,
              EXISTS (SELECT 1 FROM highlight_feed hf WHERE hf.fixture_id = f.id) AS held
         FROM fixture f
         JOIN season s ON s.id = f.season_id
         LEFT JOIN LATERAL (
           SELECT pm.external_id FROM provider_mapping pm
            WHERE pm.provider = 'highlightly' AND pm.entity_type = 'competition'
              AND pm.internal_id = s.competition_id
            ORDER BY pm.external_id LIMIT 1
         ) m ON true
         LEFT JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
         LEFT JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
        WHERE f.status = 'finished'
          AND f.kickoff_at <= $1
          AND f.kickoff_at >= $1::timestamptz - make_interval(hours => $2)
        ORDER BY f.kickoff_at, f.id`,
      [now, windowHours],
    );
    return rows.map((row) => ({
      fixtureId: row.fixture_id,
      held: row.held,
      kickoffAt: row.kickoff_at,
      competitionId: row.competition_id,
      leagueExternalId: row.league_external_id,
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
    }));
  }

  /** Stores the match's clip unless it already has one; true when written. */
  async store(fixtureId: string, clip: FeedClip): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO highlight_feed
         (fixture_id, source_id, url, title, publisher, allowed_territories, blocked_territories)
       VALUES ($1, $2, $3, $4, $5, $6::text[], $7::text[])
       ON CONFLICT (fixture_id) DO NOTHING`,
      [
        fixtureId,
        HIGHLIGHTLY_FEED_SOURCE,
        clip.url,
        clip.title,
        clip.publisher,
        clip.allowed,
        clip.blocked,
      ],
    );
    return (rowCount ?? 0) > 0;
  }
}
