import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

export interface Window {
  since: string;
  until: string;
}

export interface FixtureRow {
  id: string;
  kickoff_at: Date;
  status: string;
  competition_id: string;
  competition_name: string;
  home_id: string;
  home_name: string;
  away_id: string;
  away_name: string;
  score_home: number | null;
  score_away: number | null;
  /** Distinct members who posted or reacted on the match's public panel inside 48 hours. */
  participants: number;
}

export interface StoryRow {
  story_id: string;
  headline: string;
  language: string;
  published_at: Date | null;
  fetched_at: Date;
  source_name: string;
  url: string;
  team_ids: string[];
  competition_ids: string[];
}

export interface AnalysisRow {
  fixture_id: string;
  published_at: Date;
  predicted_outcome: 'home' | 'draw' | 'away';
  confidence: number;
  competition_id: string;
  home_id: string;
  home_name: string;
  away_id: string;
  away_name: string;
}

export interface PostRow {
  post_id: string;
  fixture_id: string;
  author_id: string;
  username: string;
  display_name: string;
  body: string;
  created_at: Date;
  home_id: string;
  home_name: string;
  away_id: string;
  away_name: string;
}

export interface FollowedMember {
  id: string;
  username: string;
  display_name: string;
}

const MATCH_SIDES = `
  JOIN season s ON s.id = f.season_id
  JOIN competition c ON c.id = s.competition_id
  JOIN fixture_participant hp ON hp.fixture_id = f.id AND hp.side = 'home'
  JOIN team hteam ON hteam.id = hp.team_id
  JOIN fixture_participant ap ON ap.fixture_id = f.id AND ap.side = 'away'
  JOIN team ateam ON ateam.id = ap.team_id`;

const ABOUT_FOLLOWED = `
  (hp.team_id = ANY($1::uuid[]) OR ap.team_id = ANY($1::uuid[]) OR s.competition_id = ANY($2::uuid[]))`;

/**
 * The reads behind the Following feed (T-333), each bounded by the window
 * and by what the member follows, and each carrying the facts the ranking
 * names -- never a count of views, which nothing here records.
 */
@Injectable()
export class PostgresFollowingFeedStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Members this member follows (T-252). Read here rather than through the
   * panel boundary's public service, whose module brings the reputation and
   * model clients with it; the table is two ids and a date.
   */
  async followedMembers(userId: string): Promise<FollowedMember[]> {
    const { rows } = await this.pool.query<FollowedMember>(
      `SELECT u.id, u.username, u.display_name
         FROM member_follow mf
         JOIN user_account u ON u.id = mf.followed_id
        WHERE mf.follower_id = $1 AND u.status = 'active'
        ORDER BY u.username`,
      [userId],
    );
    return rows;
  }

  async fixtures(teams: string[], competitions: string[], window: Window): Promise<FixtureRow[]> {
    const { rows } = await this.pool.query<FixtureRow>(
      `SELECT f.id, f.kickoff_at, f.status, s.competition_id, c.name AS competition_name,
              hp.team_id AS home_id, hteam.name AS home_name,
              ap.team_id AS away_id, ateam.name AS away_name,
              sc.home AS score_home, sc.away AS score_away,
              (SELECT count(DISTINCT u.user_id)::int
                 FROM (SELECT p.author_id AS user_id, p.created_at
                         FROM panel_post p
                        WHERE p.fixture_id = f.id AND p.removed_at IS NULL
                       UNION ALL
                       SELECT r.user_id, r.created_at
                         FROM panel_reaction r
                         JOIN panel_post p ON p.id = r.post_id
                        WHERE p.fixture_id = f.id AND p.removed_at IS NULL) u
                WHERE u.created_at >= now() - interval '48 hours') AS participants
         FROM fixture f ${MATCH_SIDES}
         LEFT JOIN fixture_score sc ON sc.fixture_id = f.id AND sc.kind = 'current'
        WHERE f.kickoff_at BETWEEN $3::timestamptz AND $4::timestamptz AND ${ABOUT_FOLLOWED}
        ORDER BY f.kickoff_at
        LIMIT 100`,
      [teams, competitions, window.since, window.until],
    );
    return rows;
  }

  async stories(teams: string[], competitions: string[], window: Window): Promise<StoryRow[]> {
    const { rows } = await this.pool.query<StoryRow>(
      `SELECT s.id AS story_id, v.headline, v.language, v.published_at, a.fetched_at,
              src.name AS source_name, a.url,
              array_remove(array_agg(DISTINCT CASE WHEN e.entity_type = 'team' THEN e.entity_id END), NULL)
                AS team_ids,
              array_remove(array_agg(DISTINCT CASE WHEN e.entity_type = 'competition' THEN e.entity_id END), NULL)
                AS competition_ids
         FROM story s
         JOIN article a ON a.id = s.promoted_article_id
         JOIN news_source src ON src.id = a.source_id AND src.dropped_at IS NULL
         JOIN LATERAL (
           SELECT headline, language, published_at
             FROM article_version
            WHERE article_id = a.id
            ORDER BY (language = src.language) DESC, created_at DESC, version_number DESC
            LIMIT 1
         ) v ON TRUE
         JOIN article m ON m.story_id = s.id
         JOIN article_entity e ON e.article_id = m.id
        WHERE COALESCE(v.published_at, a.fetched_at) BETWEEN $3::timestamptz AND $4::timestamptz
        GROUP BY s.id, v.headline, v.language, v.published_at, a.fetched_at, src.name, a.url
       HAVING bool_or((e.entity_type = 'team' AND e.entity_id = ANY($1::uuid[]))
                   OR (e.entity_type = 'competition' AND e.entity_id = ANY($2::uuid[])))
        ORDER BY COALESCE(v.published_at, a.fetched_at) DESC
        LIMIT 100`,
      [teams, competitions, window.since, window.until],
    );
    return rows;
  }

  async analyses(teams: string[], competitions: string[], window: Window): Promise<AnalysisRow[]> {
    const { rows } = await this.pool.query<AnalysisRow>(
      `SELECT fa.fixture_id, fv.published_at, fv.predicted_outcome, fv.confidence, s.competition_id,
              hp.team_id AS home_id, hteam.name AS home_name,
              ap.team_id AS away_id, ateam.name AS away_name
         FROM founder_analysis fa
         JOIN LATERAL (
           SELECT published_at, predicted_outcome, confidence
             FROM founder_analysis_version
            WHERE analysis_id = fa.id
            ORDER BY version_number DESC
            LIMIT 1
         ) fv ON TRUE
         JOIN fixture f ON f.id = fa.fixture_id ${MATCH_SIDES}
        WHERE fv.published_at BETWEEN $3::timestamptz AND $4::timestamptz AND ${ABOUT_FOLLOWED}
        ORDER BY fv.published_at DESC
        LIMIT 100`,
      [teams, competitions, window.since, window.until],
    );
    return rows;
  }

  async posts(members: string[], window: Window): Promise<PostRow[]> {
    const { rows } = await this.pool.query<PostRow>(
      `SELECT p.id AS post_id, p.fixture_id, p.author_id, u.username, u.display_name,
              p.body, p.created_at,
              hp.team_id AS home_id, hteam.name AS home_name,
              ap.team_id AS away_id, ateam.name AS away_name
         FROM panel_post p
         JOIN user_account u ON u.id = p.author_id
         JOIN fixture f ON f.id = p.fixture_id ${MATCH_SIDES}
        WHERE p.author_id = ANY($1::uuid[])
          AND p.removed_at IS NULL AND p.body IS NOT NULL
          AND p.created_at BETWEEN $2::timestamptz AND $3::timestamptz
        ORDER BY p.created_at DESC
        LIMIT 100`,
      [members, window.since, window.until],
    );
    return rows;
  }
}
