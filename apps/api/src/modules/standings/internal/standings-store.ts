import { Inject, Injectable } from '@nestjs/common';
import type { CoverageState, Leader, TableRow } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { Result } from './table';

/**
 * SQL for the standings boundary (D-025). Everything here reads what the
 * fixtures boundary stores; nothing is written.
 */
@Injectable()
export class PostgresStandingsStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Finished league-stage results of a season with their full-time score:
   * fixtures whose stage is a league (or, in a league competition, fixtures
   * with no stage), status `finished`, a `full_time` score row present.
   */
  async leagueResults(
    seasonId: string,
  ): Promise<{ results: Result[]; lastUpdatedAt: string | null }> {
    const { rows } = await this.pool.query<{
      id: string;
      kickoff_at: Date;
      updated_at: Date;
      home_id: string;
      home_name: string;
      home_short_name: string | null;
      away_id: string;
      away_name: string;
      away_short_name: string | null;
      home_goals: number;
      away_goals: number;
    }>(
      `SELECT f.id, f.kickoff_at, GREATEST(f.updated_at, sc.updated_at) AS updated_at,
              h.team_id AS home_id, th.name AS home_name, th.short_name AS home_short_name,
              a.team_id AS away_id, ta.name AS away_name, ta.short_name AS away_short_name,
              sc.home AS home_goals, sc.away AS away_goals
         FROM fixture f
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         LEFT JOIN stage st ON st.id = f.stage_id
         JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
         JOIN team th ON th.id = h.team_id
         JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
         JOIN team ta ON ta.id = a.team_id
         JOIN fixture_score sc ON sc.fixture_id = f.id AND sc.kind = 'full_time'
        WHERE f.season_id = $1
          AND f.status = 'finished'
          AND (st.kind = 'league' OR (f.stage_id IS NULL AND c.kind = 'league'))
        ORDER BY f.kickoff_at, f.id`,
      [seasonId],
    );
    let last: Date | null = null;
    for (const r of rows) if (last === null || r.updated_at > last) last = r.updated_at;
    return {
      lastUpdatedAt: last === null ? null : last.toISOString(),
      results: rows.map((r) => ({
        fixtureId: r.id,
        kickoffAt: r.kickoff_at.toISOString(),
        home: { id: r.home_id, name: r.home_name, shortName: r.home_short_name },
        away: { id: r.away_id, name: r.away_name, shortName: r.away_short_name },
        homeGoals: r.home_goals,
        awayGoals: r.away_goals,
      })),
    };
  }

  /** Every team that appears in a league-stage fixture of the season, finished or not. */
  async leagueParticipants(seasonId: string): Promise<TableRow['team'][]> {
    const { rows } = await this.pool.query<{ id: string; name: string; short_name: string | null }>(
      `SELECT DISTINCT t.id, t.name, t.short_name
         FROM fixture f
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         LEFT JOIN stage st ON st.id = f.stage_id
         JOIN fixture_participant p ON p.fixture_id = f.id
         JOIN team t ON t.id = p.team_id
        WHERE f.season_id = $1
          AND (st.kind = 'league' OR (f.stage_id IS NULL AND c.kind = 'league'))
        ORDER BY t.name`,
      [seasonId],
    );
    return rows;
  }

  /** Goals (open play and penalties; own goals are not the scorer's) per person in the season. */
  async scorers(
    seasonId: string,
    limit: number,
  ): Promise<{ leaders: Leader[]; lastUpdatedAt: string | null }> {
    const { rows } = await this.pool.query<{
      person_id: string;
      person_name: string;
      team_id: string | null;
      team_name: string | null;
      goals: string;
      updated_at: Date;
    }>(
      `SELECT i.person_id, COALESCE(pe.known_as, pe.full_name) AS person_name,
              p.team_id, t.name AS team_name,
              count(*)::text AS goals, max(i.updated_at) AS updated_at
         FROM incident i
         JOIN fixture f ON f.id = i.fixture_id
         JOIN person pe ON pe.id = i.person_id
         LEFT JOIN fixture_participant p ON p.id = i.participant_id
         LEFT JOIN team t ON t.id = p.team_id
        WHERE f.season_id = $1
          AND i.kind IN ('goal', 'penalty_goal')
          AND i.person_id IS NOT NULL
        GROUP BY i.person_id, person_name, p.team_id, t.name
        ORDER BY count(*) DESC, person_name ASC
        LIMIT $2`,
      [seasonId, limit],
    );
    let last: Date | null = null;
    for (const r of rows) if (last === null || r.updated_at > last) last = r.updated_at;
    return {
      lastUpdatedAt: last === null ? null : last.toISOString(),
      leaders: rows.map((r) => ({
        person: { id: r.person_id, name: r.person_name },
        team:
          r.team_id !== null && r.team_name !== null ? { id: r.team_id, name: r.team_name } : null,
        goals: Number(r.goals),
      })),
    };
  }

  /** What the season's coverage profile declares for one module, or null when nothing is declared. */
  async declared(seasonId: string, module: string): Promise<CoverageState | null> {
    const { rows } = await this.pool.query<{ state: CoverageState }>(
      `SELECT state FROM coverage_profile WHERE season_id = $1 AND module = $2`,
      [seasonId, module],
    );
    return rows[0]?.state ?? null;
  }
}
