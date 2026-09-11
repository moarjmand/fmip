import { Inject, Injectable } from '@nestjs/common';
import type { SquadPlayer, TeamFixture, TeamPage } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

export interface TeamSeason {
  competition: { id: string; name: string; short_name: string | null };
  season: { id: string; label: string; is_current: boolean };
}

/** SQL for the team page (T-036). Reads only. */
@Injectable()
export class PostgresTeamStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async team(id: string): Promise<TeamPage['team'] | null> {
    const { rows } = await this.pool.query<{
      id: string;
      name: string;
      short_name: string | null;
      code: string | null;
      kind: 'club' | 'national';
      gender: 'men' | 'women';
      age_group: string;
      founded_year: number | null;
      country_id: string | null;
      country_name: string | null;
      country_code: string | null;
      venue_id: string | null;
      venue_name: string | null;
      venue_city: string | null;
      venue_capacity: number | null;
    }>(
      `SELECT t.id, t.name, t.short_name, t.code, t.kind, t.gender, t.age_group, t.founded_year,
              co.id AS country_id, co.name AS country_name, co.code AS country_code,
              v.id AS venue_id, v.name AS venue_name, v.city AS venue_city, v.capacity AS venue_capacity
         FROM team t
         LEFT JOIN country co ON co.id = t.country_id
         LEFT JOIN venue v ON v.id = t.home_venue_id
        WHERE t.id = $1`,
      [id],
    );
    const r = rows[0];
    if (r === undefined) return null;
    return {
      id: r.id,
      name: r.name,
      short_name: r.short_name,
      code: r.code,
      kind: r.kind,
      gender: r.gender,
      age_group: r.age_group,
      founded_year: r.founded_year,
      country:
        r.country_id !== null && r.country_name !== null && r.country_code !== null
          ? { id: r.country_id, name: r.country_name, code: r.country_code }
          : null,
      venue:
        r.venue_id !== null && r.venue_name !== null
          ? { id: r.venue_id, name: r.venue_name, city: r.venue_city, capacity: r.venue_capacity }
          : null,
    };
  }

  /**
   * The seasons the team is active in: the current season of each competition
   * it has a fixture in, plus any season it still has an unfinished match in.
   */
  async seasons(teamId: string): Promise<TeamSeason[]> {
    const { rows } = await this.pool.query<{
      competition_id: string;
      competition_name: string;
      competition_short_name: string | null;
      season_id: string;
      season_label: string;
      is_current: boolean;
    }>(
      `SELECT DISTINCT c.id AS competition_id, c.name AS competition_name,
              c.short_name AS competition_short_name,
              se.id AS season_id, se.label AS season_label, se.is_current
         FROM fixture f
         JOIN fixture_participant p ON p.fixture_id = f.id AND p.team_id = $1
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
        WHERE se.is_current OR f.status IN ('scheduled', 'live', 'postponed', 'suspended')
        ORDER BY c.name, se.label DESC`,
      [teamId],
    );
    return rows.map((r) => ({
      competition: {
        id: r.competition_id,
        name: r.competition_name,
        short_name: r.competition_short_name,
      },
      season: { id: r.season_id, label: r.season_label, is_current: r.is_current },
    }));
  }

  /** Every fixture of the team in the given seasons, oldest first, with the best score we hold. */
  async fixtures(
    teamId: string,
    seasonIds: string[],
  ): Promise<{ fixtures: TeamFixture[]; lastUpdatedAt: string | null }> {
    if (seasonIds.length === 0) return { fixtures: [], lastUpdatedAt: null };
    const { rows } = await this.pool.query<{
      id: string;
      kickoff_at: Date;
      status: string;
      round: string | null;
      stage_id: string | null;
      stage_name: string | null;
      competition_id: string;
      competition_name: string;
      competition_short_name: string | null;
      season_id: string;
      season_label: string;
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
              c.id AS competition_id, c.name AS competition_name, c.short_name AS competition_short_name,
              se.id AS season_id, se.label AS season_label,
              h.team_id AS home_id, th.name AS home_name, th.short_name AS home_short_name,
              a.team_id AS away_id, ta.name AS away_name, ta.short_name AS away_short_name,
              COALESCE(ft.home, cur.home) AS score_home, COALESCE(ft.away, cur.away) AS score_away,
              GREATEST(f.updated_at, ft.updated_at, cur.updated_at) AS updated_at
         FROM fixture f
         JOIN fixture_participant me ON me.fixture_id = f.id AND me.team_id = $1
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         LEFT JOIN stage st ON st.id = f.stage_id
         JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
         JOIN team th ON th.id = h.team_id
         JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
         JOIN team ta ON ta.id = a.team_id
         LEFT JOIN fixture_score ft ON ft.fixture_id = f.id AND ft.kind = 'full_time'
         LEFT JOIN fixture_score cur ON cur.fixture_id = f.id AND cur.kind = 'current'
        WHERE f.season_id = ANY($2::uuid[])
        ORDER BY f.kickoff_at, f.id`,
      [teamId, seasonIds],
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
        competition: {
          id: r.competition_id,
          name: r.competition_name,
          short_name: r.competition_short_name,
        },
        season: { id: r.season_id, label: r.season_label },
        home: { id: r.home_id, name: r.home_name, short_name: r.home_short_name },
        away: { id: r.away_id, name: r.away_name, short_name: r.away_short_name },
        score:
          r.score_home !== null && r.score_away !== null
            ? { home: r.score_home, away: r.score_away }
            : null,
      })),
    };
  }

  /** Open spells: the squad as our records have it, by position, shirt number, name. */
  async squad(teamId: string): Promise<{ players: SquadPlayer[]; lastUpdatedAt: string | null }> {
    const { rows } = await this.pool.query<{
      person_id: string;
      person_name: string;
      shirt_number: number | null;
      position: SquadPlayer['position'];
      on_loan: boolean;
      start_date: string;
      updated_at: Date;
    }>(
      `SELECT ps.person_id, COALESCE(pe.known_as, pe.full_name) AS person_name,
              ps.shirt_number, ps.position, ps.on_loan, ps.start_date::text, ps.updated_at
         FROM player_spell ps
         JOIN person pe ON pe.id = ps.person_id
        WHERE ps.team_id = $1 AND ps.end_date IS NULL
        ORDER BY CASE ps.position
                   WHEN 'goalkeeper' THEN 1 WHEN 'defender' THEN 2
                   WHEN 'midfielder' THEN 3 WHEN 'forward' THEN 4 ELSE 5 END,
                 ps.shirt_number NULLS LAST, person_name`,
      [teamId],
    );
    let last: Date | null = null;
    for (const r of rows) if (last === null || r.updated_at > last) last = r.updated_at;
    return {
      lastUpdatedAt: last === null ? null : last.toISOString(),
      players: rows.map((r) => ({
        person: { id: r.person_id, name: r.person_name },
        shirt_number: r.shirt_number,
        position: r.position,
        on_loan: r.on_loan,
        since: r.start_date,
      })),
    };
  }

  async followers(teamId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM followed_entity WHERE entity_type = 'team' AND entity_id = $1`,
      [teamId],
    );
    return Number(rows[0]?.n ?? 0);
  }
}
