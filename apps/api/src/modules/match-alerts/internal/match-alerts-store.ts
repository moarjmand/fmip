import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { MatchIncident, MatchState, Side } from './match-events';

/** A reading of one match with what the line and the audience need. */
export interface MatchReading {
  fixtureId: string;
  state: MatchState;
  teams: { home: string; away: string };
}

/**
 * The SQL for match alerts (T-830). All of it, and nothing else.
 *
 * It reads the fixture tables the ingestion writes and the follow table the
 * following boundary writes; it writes only `match_alert`. The notifications
 * themselves go through `NotificationsService.emit`, which applies the
 * preferences, the mutes and the quiet hours.
 */
@Injectable()
export class MatchAlertsStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The match as it is stored now, or null when there is no such fixture or no two sides yet. */
  async reading(fixtureId: string): Promise<MatchReading | null> {
    const { rows } = await this.pool.query<{
      status: string;
      home: string | null;
      away: string | null;
      score_home: number | null;
      score_away: number | null;
    }>(
      `SELECT f.status,
              home_team.name AS home,
              away_team.name AS away,
              s.home AS score_home,
              s.away AS score_away
         FROM fixture f
         LEFT JOIN fixture_participant hp ON hp.fixture_id = f.id AND hp.side = 'home'
         LEFT JOIN team home_team ON home_team.id = hp.team_id
         LEFT JOIN fixture_participant ap ON ap.fixture_id = f.id AND ap.side = 'away'
         LEFT JOIN team away_team ON away_team.id = ap.team_id
         LEFT JOIN fixture_score s ON s.fixture_id = f.id AND s.kind = 'current'
        WHERE f.id = $1`,
      [fixtureId],
    );
    const row = rows[0];
    if (row === undefined || row.home === null || row.away === null) return null;

    const incidents = await this.pool.query<{
      sequence: number;
      kind: string;
      side: Side | null;
      person_id: string | null;
      person_name: string | null;
      minute: number;
      added_time: number | null;
    }>(
      `SELECT i.sequence, i.kind, p.side, i.person_id,
              coalesce(person.known_as, person.full_name) AS person_name,
              i.minute, i.added_time
         FROM incident i
         LEFT JOIN fixture_participant p ON p.id = i.participant_id
         LEFT JOIN person ON person.id = i.person_id
        WHERE i.fixture_id = $1
          AND i.kind IN ('goal', 'penalty_goal', 'own_goal', 'red_card', 'second_yellow_card')
        ORDER BY i.sequence`,
      [fixtureId],
    );
    const list: MatchIncident[] = incidents.rows.map((r) => ({
      sequence: r.sequence,
      kind: r.kind,
      side: r.side,
      personId: r.person_id,
      personName: r.person_name,
      minute: r.minute,
      addedTime: r.added_time,
    }));
    return {
      fixtureId,
      teams: { home: row.home, away: row.away },
      state: {
        status: row.status,
        score:
          row.score_home === null || row.score_away === null
            ? null
            : { home: row.score_home, away: row.score_away },
        incidents: list,
      },
    };
  }

  /** Every event key this match already has. */
  async history(fixtureId: string): Promise<Set<string>> {
    const { rows } = await this.pool.query<{ event_key: string }>(
      `SELECT event_key FROM match_alert WHERE fixture_id = $1`,
      [fixtureId],
    );
    return new Set(rows.map((r) => r.event_key));
  }

  /** Records one event; `false` when its key was already there (a race lost, not an error). */
  async record(entry: {
    key: string;
    fixtureId: string;
    kind: string;
    withdraws: string | null;
    line: string;
  }): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO match_alert (event_key, fixture_id, kind, withdraws, line)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (event_key) DO NOTHING`,
      [entry.key, entry.fixtureId, entry.kind, entry.withdraws, entry.line],
    );
    return rowCount === 1;
  }

  /**
   * Who follows this match: either team, or its competition (blueprint 12.1).
   * A deleted account follows nothing.
   */
  async followers(fixtureId: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `SELECT DISTINCT fe.user_id
         FROM followed_entity fe
         JOIN user_account u ON u.id = fe.user_id AND u.status <> 'deleted'
        WHERE (fe.entity_type = 'team'
               AND fe.entity_id IN (SELECT team_id FROM fixture_participant WHERE fixture_id = $1))
           OR (fe.entity_type = 'competition'
               AND fe.entity_id = (SELECT s.competition_id
                                     FROM fixture f JOIN season s ON s.id = f.season_id
                                    WHERE f.id = $1))
        ORDER BY fe.user_id`,
      [fixtureId],
    );
    return rows.map((r) => r.user_id);
  }

  /**
   * Who was told about a goal: the members a correction goes to. A member
   * the goal never reached -- muted, turned off, capped -- has nothing to
   * correct.
   */
  async toldOf(eventKey: string): Promise<string[]> {
    const { rows } = await this.pool.query<{ user_id: string }>(
      `SELECT user_id FROM notification
        WHERE kind = 'match_goal' AND dedupe_key = $1
        ORDER BY user_id`,
      [eventKey],
    );
    return rows.map((r) => r.user_id);
  }
}
