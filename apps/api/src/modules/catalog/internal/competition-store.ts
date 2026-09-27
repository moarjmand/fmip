import { Inject, Injectable } from '@nestjs/common';
import type {
  CompetitionPage,
  CoverageState,
  SeasonFixture,
  SeasonSummary,
  StageSummary,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { BracketFixture } from './bracket';

/** SQL for the competition page (T-035). Reads only. */
@Injectable()
export class PostgresCompetitionStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async competition(
    id: string,
    locale: string | null = null,
  ): Promise<CompetitionPage['competition'] | null> {
    const { rows } = await this.pool.query<{
      id: string;
      name: string;
      localised_name: string | null;
      short_name: string | null;
      kind: CompetitionPage['competition']['kind'];
      scope: CompetitionPage['competition']['scope'];
      gender: 'men' | 'women';
      age_group: string;
      tier: number | null;
      country_id: string | null;
      country_name: string | null;
      country_code: string | null;
    }>(
      `SELECT c.id, c.name, localised_name('competition', c.id, $2) AS localised_name,
              c.short_name, c.kind, c.scope, c.gender, c.age_group, c.tier,
              co.id AS country_id, co.name AS country_name, co.code AS country_code
         FROM competition c
         LEFT JOIN country co ON co.id = c.country_id
        WHERE c.id = $1`,
      [id, locale],
    );
    const r = rows[0];
    if (r === undefined) return null;
    return {
      id: r.id,
      name: r.name,
      localised_name: r.localised_name,
      short_name: r.short_name,
      kind: r.kind,
      scope: r.scope,
      gender: r.gender,
      age_group: r.age_group,
      tier: r.tier,
      country:
        r.country_id !== null && r.country_name !== null && r.country_code !== null
          ? { id: r.country_id, name: r.country_name, code: r.country_code }
          : null,
    };
  }

  /** Newest first. */
  async seasons(competitionId: string): Promise<SeasonSummary[]> {
    const { rows } = await this.pool.query<{
      id: string;
      label: string;
      start_date: string;
      end_date: string;
      is_current: boolean;
    }>(
      `SELECT id, label, start_date::text, end_date::text, is_current
         FROM season WHERE competition_id = $1
        ORDER BY start_date DESC, label DESC`,
      [competitionId],
    );
    return rows;
  }

  async stages(seasonId: string): Promise<StageSummary[]> {
    const { rows } = await this.pool.query<StageSummary>(
      `SELECT id, name, kind, sort_order, legs FROM stage WHERE season_id = $1 ORDER BY sort_order`,
      [seasonId],
    );
    return rows;
  }

  /** Every fixture of the season with both teams and the best score we hold. */
  async fixtures(
    seasonId: string,
  ): Promise<{ fixtures: SeasonFixture[]; lastUpdatedAt: string | null }> {
    const { rows } = await this.pool.query<{
      id: string;
      kickoff_at: Date;
      status: string;
      round: string | null;
      stage_id: string | null;
      stage_name: string | null;
      home_id: string;
      home_name: string;
      home_short_name: string | null;
      away_id: string;
      away_name: string;
      away_short_name: string | null;
      score_home: number | null;
      score_away: number | null;
      updated_at: Date;
    }>(
      `SELECT f.id, f.kickoff_at, f.status, f.round, f.stage_id, st.name AS stage_name,
              h.team_id AS home_id, th.name AS home_name, th.short_name AS home_short_name,
              a.team_id AS away_id, ta.name AS away_name, ta.short_name AS away_short_name,
              COALESCE(ft.home, cur.home) AS score_home, COALESCE(ft.away, cur.away) AS score_away,
              GREATEST(f.updated_at, ft.updated_at, cur.updated_at) AS updated_at
         FROM fixture f
         LEFT JOIN stage st ON st.id = f.stage_id
         JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
         JOIN team th ON th.id = h.team_id
         JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
         JOIN team ta ON ta.id = a.team_id
         LEFT JOIN fixture_score ft ON ft.fixture_id = f.id AND ft.kind = 'full_time'
         LEFT JOIN fixture_score cur ON cur.fixture_id = f.id AND cur.kind = 'current'
        WHERE f.season_id = $1
        ORDER BY f.kickoff_at, f.id`,
      [seasonId],
    );
    let last: Date | null = null;
    for (const r of rows) if (last === null || r.updated_at > last) last = r.updated_at;
    return {
      lastUpdatedAt: last === null ? null : last.toISOString(),
      fixtures: rows.map((r) => ({
        id: r.id,
        kickoff_at: r.kickoff_at.toISOString(),
        status: r.status,
        round: r.round,
        stage:
          r.stage_id !== null && r.stage_name !== null
            ? { id: r.stage_id, name: r.stage_name }
            : null,
        home: { id: r.home_id, name: r.home_name, short_name: r.home_short_name },
        away: { id: r.away_id, name: r.away_name, short_name: r.away_short_name },
        score:
          r.score_home !== null && r.score_away !== null
            ? { home: r.score_home, away: r.score_away }
            : null,
      })),
    };
  }

  /**
   * Every fixture of the season as the knockout bracket reads it (T-630):
   * the latest score rather than the 90-minute one, since extra time decides
   * a tie, plus the shoot-out and the leg when our records hold them.
   */
  async bracketFixtures(seasonId: string): Promise<BracketFixture[]> {
    const { rows } = await this.pool.query<{
      id: string;
      kickoff_at: Date;
      status: string;
      round: string | null;
      leg: number | null;
      stage_name: string | null;
      stage_kind: string | null;
      home_id: string;
      home_name: string;
      home_short_name: string | null;
      away_id: string;
      away_name: string;
      away_short_name: string | null;
      score_home: number | null;
      score_away: number | null;
      extra_time: boolean;
      pen_home: number | null;
      pen_away: number | null;
    }>(
      `SELECT f.id, f.kickoff_at, f.status, f.round, f.leg,
              st.name AS stage_name, st.kind AS stage_kind,
              h.team_id AS home_id, th.name AS home_name, th.short_name AS home_short_name,
              a.team_id AS away_id, ta.name AS away_name, ta.short_name AS away_short_name,
              COALESCE(cur.home, ft.home) AS score_home, COALESCE(cur.away, ft.away) AS score_away,
              et.id IS NOT NULL AS extra_time,
              pen.home AS pen_home, pen.away AS pen_away
         FROM fixture f
         LEFT JOIN stage st ON st.id = f.stage_id
         JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
         JOIN team th ON th.id = h.team_id
         JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
         JOIN team ta ON ta.id = a.team_id
         LEFT JOIN fixture_score ft ON ft.fixture_id = f.id AND ft.kind = 'full_time'
         LEFT JOIN fixture_score cur ON cur.fixture_id = f.id AND cur.kind = 'current'
         LEFT JOIN fixture_score et ON et.fixture_id = f.id AND et.kind = 'extra_time'
         LEFT JOIN fixture_score pen ON pen.fixture_id = f.id AND pen.kind = 'penalties'
        WHERE f.season_id = $1
        ORDER BY f.kickoff_at, f.id`,
      [seasonId],
    );
    return rows.map((r) => ({
      id: r.id,
      kickoff_at: r.kickoff_at.toISOString(),
      status: r.status,
      round: r.round,
      stage:
        r.stage_name !== null && r.stage_kind !== null
          ? { name: r.stage_name, kind: r.stage_kind }
          : null,
      leg: r.leg,
      home: { id: r.home_id, name: r.home_name, short_name: r.home_short_name },
      away: { id: r.away_id, name: r.away_name, short_name: r.away_short_name },
      score:
        r.score_home !== null && r.score_away !== null
          ? { home: r.score_home, away: r.score_away }
          : null,
      after_extra_time: r.extra_time,
      penalties:
        r.pen_home !== null && r.pen_away !== null ? { home: r.pen_home, away: r.pen_away } : null,
    }));
  }

  async coverage(seasonId: string): Promise<Record<string, CoverageState>> {
    const { rows } = await this.pool.query<{ module: string; state: CoverageState }>(
      `SELECT module, state FROM coverage_profile WHERE season_id = $1 ORDER BY module`,
      [seasonId],
    );
    return Object.fromEntries(rows.map((r) => [r.module, r.state]));
  }
}
