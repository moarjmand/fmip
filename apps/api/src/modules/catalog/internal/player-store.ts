import { Inject, Injectable } from '@nestjs/common';
import type { PlayerMatch, PlayerPage, PlayerSeasonRecord, PlayerSpell } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/** SQL for the player page (T-037). Reads only; everything comes from line-ups, incidents and spells. */
@Injectable()
export class PostgresPlayerStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async person(id: string): Promise<PlayerPage['person'] | null> {
    const { rows } = await this.pool.query<{
      id: string;
      full_name: string;
      known_as: string | null;
      date_of_birth: string | null;
      height_cm: number | null;
      preferred_foot: PlayerPage['person']['preferred_foot'];
      nationality_id: string | null;
      nationality_name: string | null;
      nationality_code: string | null;
    }>(
      `SELECT p.id, p.full_name, p.known_as, p.date_of_birth::text, p.height_cm, p.preferred_foot,
              co.id AS nationality_id, co.name AS nationality_name, co.code AS nationality_code
         FROM person p
         LEFT JOIN country co ON co.id = p.nationality_id
        WHERE p.id = $1`,
      [id],
    );
    const r = rows[0];
    if (r === undefined) return null;
    return {
      id: r.id,
      full_name: r.full_name,
      known_as: r.known_as,
      date_of_birth: r.date_of_birth,
      nationality:
        r.nationality_id !== null && r.nationality_name !== null && r.nationality_code !== null
          ? { id: r.nationality_id, name: r.nationality_name, code: r.nationality_code }
          : null,
      height_cm: r.height_cm,
      preferred_foot: r.preferred_foot,
    };
  }

  /** Newest first; an open spell (no end) before any closed one starting the same day. */
  async spells(personId: string): Promise<PlayerSpell[]> {
    const { rows } = await this.pool.query<{
      team_id: string;
      team_name: string;
      team_short_name: string | null;
      start_date: string;
      end_date: string | null;
      shirt_number: number | null;
      position: PlayerSpell['position'];
      on_loan: boolean;
    }>(
      `SELECT t.id AS team_id, t.name AS team_name, t.short_name AS team_short_name,
              ps.start_date::text, ps.end_date::text, ps.shirt_number, ps.position, ps.on_loan
         FROM player_spell ps JOIN team t ON t.id = ps.team_id
        WHERE ps.person_id = $1
        ORDER BY ps.start_date DESC, ps.end_date DESC NULLS FIRST`,
      [personId],
    );
    return rows.map((r) => ({
      team: { id: r.team_id, name: r.team_name, short_name: r.team_short_name },
      start_date: r.start_date,
      end_date: r.end_date,
      shirt_number: r.shirt_number,
      position: r.position,
      on_loan: r.on_loan,
    }));
  }

  /**
   * One row per season, competition and team the player was named for:
   * starts, bench appearances that became a substitution on, goals (open play
   * and penalties), assists, cards — each counted only for the team of the
   * line-up, so a mid-season move gives two honest rows.
   */
  async record(personId: string): Promise<PlayerSeasonRecord[]> {
    const { rows } = await this.pool.query<{
      season_id: string;
      season_label: string;
      competition_id: string;
      competition_name: string;
      competition_short_name: string | null;
      team_id: string;
      team_name: string;
      starts: string;
      sub_appearances: string;
      goals: string;
      assists: string;
      yellow_cards: string;
      red_cards: string;
    }>(
      `WITH named AS (
         SELECT f.id AS fixture_id, f.season_id, p.id AS participant_id, p.team_id, l.role,
                EXISTS (SELECT 1 FROM incident s
                         WHERE s.fixture_id = f.id AND s.kind = 'substitution'
                           AND s.related_person_id = l.person_id) AS came_on
           FROM lineup l
           JOIN fixture_participant p ON p.id = l.participant_id
           JOIN fixture f ON f.id = p.fixture_id
          WHERE l.person_id = $1
       ), counted AS (
         SELECT n.season_id, n.team_id,
                count(*) FILTER (WHERE n.role = 'starter') AS starts,
                count(*) FILTER (WHERE n.role = 'bench' AND n.came_on) AS sub_appearances,
                (SELECT count(*) FROM incident i
                  WHERE i.participant_id = ANY(array_agg(n.participant_id))
                    AND i.person_id = $1 AND i.kind IN ('goal', 'penalty_goal')) AS goals,
                (SELECT count(*) FROM incident i
                  WHERE i.participant_id = ANY(array_agg(n.participant_id))
                    AND i.related_person_id = $1 AND i.kind IN ('goal', 'penalty_goal')) AS assists,
                (SELECT count(*) FROM incident i
                  WHERE i.participant_id = ANY(array_agg(n.participant_id))
                    AND i.person_id = $1 AND i.kind = 'yellow_card') AS yellow_cards,
                (SELECT count(*) FROM incident i
                  WHERE i.participant_id = ANY(array_agg(n.participant_id))
                    AND i.person_id = $1 AND i.kind IN ('red_card', 'second_yellow_card')) AS red_cards
           FROM named n
          GROUP BY n.season_id, n.team_id
       )
       SELECT se.id AS season_id, se.label AS season_label,
              c.id AS competition_id, c.name AS competition_name, c.short_name AS competition_short_name,
              t.id AS team_id, t.name AS team_name,
              k.starts::text, k.sub_appearances::text, k.goals::text, k.assists::text,
              k.yellow_cards::text, k.red_cards::text
         FROM counted k
         JOIN season se ON se.id = k.season_id
         JOIN competition c ON c.id = se.competition_id
         JOIN team t ON t.id = k.team_id
        ORDER BY se.start_date DESC, c.name, t.name`,
      [personId],
    );
    return rows.map((r) => ({
      season: { id: r.season_id, label: r.season_label },
      competition: {
        id: r.competition_id,
        name: r.competition_name,
        short_name: r.competition_short_name,
      },
      team: { id: r.team_id, name: r.team_name },
      starts: Number(r.starts),
      sub_appearances: Number(r.sub_appearances),
      goals: Number(r.goals),
      assists: Number(r.assists),
      yellow_cards: Number(r.yellow_cards),
      red_cards: Number(r.red_cards),
    }));
  }

  /** The last `limit` matches the player was named for, newest kick-off first. */
  async recent(
    personId: string,
    limit: number,
  ): Promise<{ matches: PlayerMatch[]; lastUpdatedAt: string | null }> {
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
      team_id: string;
      team_name: string;
      role: 'starter' | 'bench';
      came_on: boolean;
      goals: string;
      assists: string;
      yellow_cards: string;
      red_cards: string;
      updated_at: Date;
    }>(
      `SELECT f.id, f.kickoff_at, f.status, f.round, f.stage_id, st.name AS stage_name,
              c.id AS competition_id, c.name AS competition_name, c.short_name AS competition_short_name,
              se.id AS season_id, se.label AS season_label,
              h.team_id AS home_id, th.name AS home_name, th.short_name AS home_short_name,
              a.team_id AS away_id, ta.name AS away_name, ta.short_name AS away_short_name,
              COALESCE(ft.home, cur.home) AS score_home, COALESCE(ft.away, cur.away) AS score_away,
              me.team_id, tm.name AS team_name, l.role,
              EXISTS (SELECT 1 FROM incident s WHERE s.fixture_id = f.id AND s.kind = 'substitution'
                        AND s.related_person_id = $1) AS came_on,
              (SELECT count(*) FROM incident i WHERE i.fixture_id = f.id AND i.person_id = $1
                  AND i.kind IN ('goal', 'penalty_goal'))::text AS goals,
              (SELECT count(*) FROM incident i WHERE i.fixture_id = f.id AND i.related_person_id = $1
                  AND i.kind IN ('goal', 'penalty_goal'))::text AS assists,
              (SELECT count(*) FROM incident i WHERE i.fixture_id = f.id AND i.person_id = $1
                  AND i.kind = 'yellow_card')::text AS yellow_cards,
              (SELECT count(*) FROM incident i WHERE i.fixture_id = f.id AND i.person_id = $1
                  AND i.kind IN ('red_card', 'second_yellow_card'))::text AS red_cards,
              GREATEST(f.updated_at, l.updated_at,
                (SELECT max(i.updated_at) FROM incident i WHERE i.fixture_id = f.id
                    AND (i.person_id = $1 OR i.related_person_id = $1))) AS updated_at
         FROM lineup l
         JOIN fixture_participant me ON me.id = l.participant_id
         JOIN team tm ON tm.id = me.team_id
         JOIN fixture f ON f.id = me.fixture_id
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         LEFT JOIN stage st ON st.id = f.stage_id
         JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
         JOIN team th ON th.id = h.team_id
         JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
         JOIN team ta ON ta.id = a.team_id
         LEFT JOIN fixture_score ft ON ft.fixture_id = f.id AND ft.kind = 'full_time'
         LEFT JOIN fixture_score cur ON cur.fixture_id = f.id AND cur.kind = 'current'
        WHERE l.person_id = $1
        ORDER BY f.kickoff_at DESC, f.id
        LIMIT $2`,
      [personId, limit],
    );
    let last: Date | null = null;
    for (const r of rows) if (last === null || r.updated_at > last) last = r.updated_at;
    return {
      lastUpdatedAt: last === null ? null : last.toISOString(),
      matches: rows.map((r) => ({
        fixture: {
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
        },
        team: { id: r.team_id, name: r.team_name },
        role: r.role,
        came_on: r.came_on,
        goals: Number(r.goals),
        assists: Number(r.assists),
        yellow_cards: Number(r.yellow_cards),
        red_cards: Number(r.red_cards),
      })),
    };
  }
}
