import { Inject, Injectable } from '@nestjs/common';
import type { PredictionShare } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { ShareableRow } from './share';

interface ShareRow {
  token: string;
  created_at: Date;
}

const toShare = (row: ShareRow): PredictionShare => ({
  token: row.token,
  created_at: row.created_at.toISOString(),
});

/**
 * The SQL behind a prediction's public link (T-1723, D-351): the prediction
 * with its current settlement, and the `prediction_share` rows. Who may make
 * a link is also the schema's rule (`prediction_share_owner_guard`), and the
 * ceiling on making them is its trigger (`prediction_share_volume_guard`).
 */
@Injectable()
export class PostgresShareStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** One prediction with its newest settlement and the version that settled, or null. */
  async shareable(predictionId: string): Promise<ShareableRow | null> {
    const { rows } = await this.pool.query<ShareableRow>(
      `SELECT p.id AS prediction_id, p.user_id, u.username, u.status AS account_status,
              f.id AS fixture_id, f.kickoff_at, f.round, c.name AS competition,
              th.name AS home_name, th.short_name AS home_short_name,
              ta.name AS away_name, ta.short_name AS away_short_name,
              s.status AS settlement_status, s.outcome_correct, s.score_correct,
              s.actual_home, s.actual_away,
              v.outcome, v.home_goals, v.away_goals, v.submitted_at
         FROM user_prediction p
         JOIN user_account u ON u.id = p.user_id
         JOIN fixture f ON f.id = p.fixture_id
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
         JOIN team th ON th.id = h.team_id
         JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
         JOIN team ta ON ta.id = a.team_id
         LEFT JOIN LATERAL (
           SELECT st.* FROM settlement st
            WHERE st.prediction_id = p.id
            ORDER BY st.settled_at DESC, st.id DESC LIMIT 1
         ) s ON true
         LEFT JOIN prediction_version v ON v.id = s.version_id
        WHERE p.id = $1`,
      [predictionId],
    );
    return rows[0] ?? null;
  }

  /** The live link of a prediction, or null. */
  async live(predictionId: string): Promise<PredictionShare | null> {
    const { rows } = await this.pool.query<ShareRow>(
      `SELECT token, created_at FROM prediction_share
        WHERE prediction_id = $1 AND revoked_at IS NULL`,
      [predictionId],
    );
    const row = rows[0];
    return row === undefined ? null : toShare(row);
  }

  /**
   * Makes the live link, or answers the one already standing (the partial
   * unique index): pressing Share twice is one link and one count against
   * the ceiling. `created` says which.
   */
  async create(
    predictionId: string,
    userId: string,
    token: string,
  ): Promise<{ share: PredictionShare; created: boolean }> {
    const { rows } = await this.pool.query<ShareRow>(
      `INSERT INTO prediction_share (token, prediction_id, user_id)
       VALUES ($1, $2, $3)
       ON CONFLICT (prediction_id) WHERE revoked_at IS NULL DO NOTHING
       RETURNING token, created_at`,
      [token, predictionId, userId],
    );
    const made = rows[0];
    if (made !== undefined) return { share: toShare(made), created: true };
    const standing = await this.live(predictionId);
    if (standing === null) throw new Error('prediction_share: no row made and none standing');
    return { share: standing, created: false };
  }

  /** Revokes the live link, if any. Returns whether one was revoked. */
  async revoke(predictionId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE prediction_share SET revoked_at = now()
        WHERE prediction_id = $1 AND revoked_at IS NULL`,
      [predictionId],
    );
    return (rowCount ?? 0) > 0;
  }

  /** The prediction a live token opens, or null (unknown or revoked). */
  async predictionOf(token: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ prediction_id: string }>(
      `SELECT prediction_id FROM prediction_share WHERE token = $1 AND revoked_at IS NULL`,
      [token],
    );
    return rows[0]?.prediction_id ?? null;
  }
}
