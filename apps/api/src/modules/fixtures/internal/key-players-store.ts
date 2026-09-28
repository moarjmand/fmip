import { Inject, Injectable } from '@nestjs/common';
import type { KeyPlayer } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { SeasonFigures } from './key-players';

export interface KeyPlayersFixture {
  id: string;
  kickoffAt: string;
  competition: { id: string; name: string };
  season: { id: string; label: string };
  home: { id: string; name: string };
  away: { id: string; name: string };
}

export interface TeamSeason {
  played: number;
  withFigures: number;
  players: SeasonFigures[];
  lastUpdatedAt: string | null;
}

/**
 * SQL for the key players (T-841). Reads only: the season's finished matches
 * of a team before a kick-off and the per-match player figures (T-101) of
 * that team's side in them.
 */
@Injectable()
export class PostgresKeyPlayersStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async fixture(fixtureId: string): Promise<KeyPlayersFixture | null> {
    const { rows } = await this.pool.query<{
      id: string;
      kickoff_at: Date;
      competition_id: string;
      competition_name: string;
      season_id: string;
      season_label: string;
      home_id: string;
      home_name: string;
      away_id: string;
      away_name: string;
    }>(
      `SELECT f.id, f.kickoff_at, c.id AS competition_id, c.name AS competition_name,
              se.id AS season_id, se.label AS season_label,
              th.id AS home_id, th.name AS home_name, ta.id AS away_id, ta.name AS away_name
         FROM fixture f
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
         JOIN team th ON th.id = h.team_id
         JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
         JOIN team ta ON ta.id = a.team_id
        WHERE f.id = $1`,
      [fixtureId],
    );
    const r = rows[0];
    if (r === undefined) return null;
    return {
      id: r.id,
      kickoffAt: r.kickoff_at.toISOString(),
      competition: { id: r.competition_id, name: r.competition_name },
      season: { id: r.season_id, label: r.season_label },
      home: { id: r.home_id, name: r.home_name },
      away: { id: r.away_id, name: r.away_name },
    };
  }

  /**
   * A team's season in this competition before `before`: how many finished
   * matches it played, how many of them carry player figures for its side,
   * and each player's figures summed over them.
   */
  async teamSeason(seasonId: string, teamId: string, before: string): Promise<TeamSeason> {
    const played = `
      SELECT fp.id AS participant_id, f.kickoff_at
        FROM fixture f
        JOIN fixture_participant fp ON fp.fixture_id = f.id
       WHERE f.season_id = $1 AND fp.team_id = $2
         AND f.status = 'finished' AND f.kickoff_at < $3`;
    const [counts, players] = await Promise.all([
      this.pool.query<{ played: string; with_figures: string }>(
        `WITH played AS (${played})
         SELECT count(*)::text AS played,
                count(*) FILTER (WHERE EXISTS (
                  SELECT 1 FROM fixture_player_stat s
                   WHERE s.participant_id = played.participant_id AND s.metric = 'minutes'
                ))::text AS with_figures
           FROM played`,
        [seasonId, teamId, before],
      ),
      this.pool.query<{
        person_id: string;
        name: string;
        position: KeyPlayer['position'];
        minutes: number | null;
        appearances: string;
        goals: number | null;
        assists: number | null;
        updated_at: Date;
      }>(
        `WITH played AS (${played})
         SELECT s.person_id, COALESCE(pe.known_as, pe.full_name) AS name,
                (SELECT l.position FROM lineup l
                   JOIN played lp ON lp.participant_id = l.participant_id
                  WHERE l.person_id = s.person_id AND l.position IS NOT NULL
                  ORDER BY lp.kickoff_at DESC LIMIT 1) AS position,
                sum(s.value) FILTER (WHERE s.metric = 'minutes')::float8 AS minutes,
                count(*) FILTER (WHERE s.metric = 'minutes' AND s.value > 0)::text AS appearances,
                sum(s.value) FILTER (WHERE s.metric = 'goals')::float8 AS goals,
                sum(s.value) FILTER (WHERE s.metric = 'assists')::float8 AS assists,
                max(s.updated_at) AS updated_at
           FROM played
           JOIN fixture_player_stat s ON s.participant_id = played.participant_id
           JOIN person pe ON pe.id = s.person_id
          WHERE s.metric IN ('minutes', 'goals', 'assists')
          GROUP BY s.person_id, name`,
        [seasonId, teamId, before],
      ),
    ]);
    let last: Date | null = null;
    for (const r of players.rows) if (last === null || r.updated_at > last) last = r.updated_at;
    return {
      played: Number(counts.rows[0]?.played ?? 0),
      withFigures: Number(counts.rows[0]?.with_figures ?? 0),
      players: players.rows.map((r) => ({
        id: r.person_id,
        name: r.name,
        position: r.position,
        appearances: Number(r.appearances),
        minutes: r.minutes ?? 0,
        goals: r.goals ?? 0,
        assists: r.assists ?? 0,
      })),
      lastUpdatedAt: last?.toISOString() ?? null,
    };
  }
}
