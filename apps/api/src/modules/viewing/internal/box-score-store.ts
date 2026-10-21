import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { BoxScoreCandidate, ExpectedRow } from './box-score-feed';

/** The one source this table holds today (migration `1765877000000`). */
export const BOX_SCORE_SOURCE = 'highlightly';

/** A line-up row of the match: what a reviewer is shown beside an unmapped player. */
export interface LineupShirt {
  participantId: string;
  shirtNumber: number;
  personId: string;
  /** The names we hold for that person (full name, known-as), for the line-up rule (T-1436). */
  names: string[];
}

/**
 * The box-score job's SQL (T-1432, D-224): the finished matches inside the
 * window still owed a box score, the match's line-up shirts (a hint for the
 * review queue, never a mapping), and the one write -- a match's figures from
 * the source, replaced whole, with the record that it answered.
 */
@Injectable()
export class PostgresBoxScoreStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * `held` when the source's box score is stored and either placed every
   * player or was asked for after `reaskBefore`; a match with players still
   * unplaced is asked for again once that is past.
   */
  async candidates(
    now: Date,
    windowHours: number,
    reaskBefore: Date,
  ): Promise<BoxScoreCandidate[]> {
    const { rows } = await this.pool.query<{
      fixture_id: string;
      kickoff_at: Date;
      competition_id: string;
      league_external_id: string | null;
      home_team_id: string | null;
      away_team_id: string | null;
      home_participant_id: string | null;
      away_participant_id: string | null;
      held: boolean;
    }>(
      `SELECT f.id AS fixture_id, f.kickoff_at, s.competition_id,
              m.external_id AS league_external_id,
              h.team_id AS home_team_id, a.team_id AS away_team_id,
              h.id AS home_participant_id, a.id AS away_participant_id,
              EXISTS (SELECT 1 FROM fixture_box_score b
                       WHERE b.fixture_id = f.id AND b.source = $3
                         AND (b.unresolved = 0 OR b.fetched_at > $4)) AS held
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
      [now, windowHours, BOX_SCORE_SOURCE, reaskBefore],
    );
    return rows.map((row) => ({
      fixtureId: row.fixture_id,
      held: row.held,
      kickoffAt: row.kickoff_at,
      competitionId: row.competition_id,
      leagueExternalId: row.league_external_id,
      homeTeamId: row.home_team_id,
      awayTeamId: row.away_team_id,
      homeParticipantId: row.home_participant_id,
      awayParticipantId: row.away_participant_id,
    }));
  }

  async lineupShirts(participantIds: string[]): Promise<LineupShirt[]> {
    const { rows } = await this.pool.query<{
      participant_id: string;
      shirt_number: number;
      person_id: string;
      full_name: string | null;
      known_as: string | null;
    }>(
      `SELECT l.participant_id, l.shirt_number, l.person_id, p.full_name, p.known_as
         FROM lineup l JOIN person p ON p.id = l.person_id
        WHERE l.participant_id = ANY($1::uuid[]) AND l.shirt_number IS NOT NULL`,
      [participantIds],
    );
    return rows.map((r) => ({
      participantId: r.participant_id,
      shirtNumber: r.shirt_number,
      personId: r.person_id,
      names: [r.full_name, r.known_as].filter((n): n is string => n !== null && n !== ''),
    }));
  }

  /**
   * Replaces the match's figures from the source with `rows` and records the
   * answer, in one transaction: a re-asked box score never leaves half of the
   * old one behind.
   */
  async store(
    candidate: Pick<BoxScoreCandidate, 'fixtureId' | 'homeParticipantId' | 'awayParticipantId'>,
    answer: { rows: ExpectedRow[]; players: number; unresolved: number; fetchedAt: string },
  ): Promise<void> {
    const sides = [candidate.homeParticipantId, candidate.awayParticipantId].filter(
      (id): id is string => id !== null,
    );
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `DELETE FROM fixture_player_expected
          WHERE participant_id = ANY($1::uuid[]) AND source = $2`,
        [sides, BOX_SCORE_SOURCE],
      );
      if (answer.rows.length > 0) {
        await client.query(
          `INSERT INTO fixture_player_expected (participant_id, person_id, source, metric, value)
           SELECT p, pe, $5, m, v
             FROM unnest($1::uuid[], $2::uuid[], $3::text[], $4::numeric[]) AS t(p, pe, m, v)`,
          [
            answer.rows.map((r) => r.participantId),
            answer.rows.map((r) => r.personId),
            answer.rows.map((r) => r.metric),
            answer.rows.map((r) => r.value),
            BOX_SCORE_SOURCE,
          ],
        );
      }
      await client.query(
        `INSERT INTO fixture_box_score (fixture_id, source, fetched_at, players, unresolved)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (fixture_id, source) DO UPDATE
           SET fetched_at = EXCLUDED.fetched_at, players = EXCLUDED.players,
               unresolved = EXCLUDED.unresolved`,
        [
          candidate.fixtureId,
          BOX_SCORE_SOURCE,
          answer.fetchedAt,
          answer.players,
          answer.unresolved,
        ],
      );
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
