import { Inject, Injectable } from '@nestjs/common';
import type {
  GroupPredictionCall,
  Prediction,
  PredictionHistoryItem,
  PredictionOutcome,
  PredictionReasonTag,
  PredictionVersion,
  Settlement,
  SettlementVoidReason,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { PredictionInput } from './validation';

export interface FixtureLock {
  id: string;
  kickoffAt: Date;
  status: string;
}

interface VersionRow {
  id: string;
  version_number: number;
  outcome: PredictionOutcome;
  home_goals: number | null;
  away_goals: number | null;
  confidence: number;
  reason_tags: PredictionReasonTag[];
  explanation: string | null;
  submitted_at: Date;
}

const toVersion = (row: VersionRow): PredictionVersion => ({
  id: row.id,
  version_number: row.version_number,
  outcome: row.outcome,
  score:
    row.home_goals !== null && row.away_goals !== null
      ? { home: row.home_goals, away: row.away_goals }
      : null,
  confidence: row.confidence,
  reason_tags: row.reason_tags,
  explanation: row.explanation,
  submitted_at: row.submitted_at.toISOString(),
});

interface SettlementRow {
  id: string;
  status: 'settled' | 'void';
  void_reason: SettlementVoidReason | null;
  actual_home: number | null;
  actual_away: number | null;
  outcome_correct: boolean | null;
  score_predicted: boolean;
  score_correct: boolean | null;
  confidence: number;
  settled_at: Date;
  version_number: number;
}

/**
 * A settlement row as the contract's `Settlement`.
 *
 * One mapper for the single read and the bulk one (T-246), because the
 * comparison must show *the* settlement and not a second reading of it.
 */
const toSettlement = (row: SettlementRow): Settlement => ({
  id: row.id,
  status: row.status,
  void_reason: row.void_reason,
  actual:
    row.actual_home !== null && row.actual_away !== null
      ? { home: row.actual_home, away: row.actual_away }
      : null,
  outcome_correct: row.outcome_correct,
  score_predicted: row.score_predicted,
  score_correct: row.score_correct,
  confidence: row.confidence,
  settled_at: row.settled_at.toISOString(),
  version_number: row.version_number,
});

const SETTLEMENT_COLUMNS = `s.id, s.status, s.void_reason, s.actual_home, s.actual_away,
              s.outcome_correct, s.score_predicted, s.score_correct, s.confidence,
              s.settled_at, v.version_number`;

/** SQLSTATE raised by refuse_prediction_after_kickoff() (migration 1758900000000). */
export const LOCKED_SQLSTATE = 'PL001';

export class PredictionLockedError extends Error {
  constructor() {
    super('predictions are locked at kick-off');
    this.name = 'PredictionLockedError';
  }
}

/** SQL for the predictions boundary (D-025). Versions are only ever inserted. */
@Injectable()
export class PostgresPredictionStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async fixtureLock(fixtureId: string): Promise<FixtureLock | null> {
    const { rows } = await this.pool.query<{ id: string; kickoff_at: Date; status: string }>(
      `SELECT id, kickoff_at, status FROM fixture WHERE id = $1`,
      [fixtureId],
    );
    const row = rows[0];
    return row === undefined ? null : { id: row.id, kickoffAt: row.kickoff_at, status: row.status };
  }

  /**
   * Writes the next version inside one transaction: the prediction row is
   * created on first submission and only touched (updated_at) afterwards;
   * the version number is MAX + 1 under the row's lock, so two submissions
   * racing each other cannot share a number.
   */
  async submit(userId: string, fixtureId: string, input: PredictionInput): Promise<Prediction> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const upsert = await client.query<{ id: string }>(
        `INSERT INTO user_prediction (user_id, fixture_id) VALUES ($1, $2)
           ON CONFLICT (user_id, fixture_id) DO UPDATE SET updated_at = now()
           RETURNING id`,
        [userId, fixtureId],
      );
      const predictionId = upsert.rows[0]?.id;
      if (predictionId === undefined) throw new Error('user_prediction upsert returned no row');
      await client.query(`SELECT id FROM user_prediction WHERE id = $1 FOR UPDATE`, [predictionId]);
      await client.query(
        `INSERT INTO prediction_version
           (prediction_id, version_number, outcome, home_goals, away_goals, confidence, reason_tags, explanation)
         SELECT $1, COALESCE(MAX(version_number), 0) + 1, $2, $3, $4, $5, $6::text[], $7
           FROM prediction_version WHERE prediction_id = $1`,
        [
          predictionId,
          input.outcome,
          input.score?.home ?? null,
          input.score?.away ?? null,
          input.confidence,
          input.reasonTags,
          input.explanation,
        ],
      );
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === LOCKED_SQLSTATE) throw new PredictionLockedError();
      throw error;
    } finally {
      client.release();
    }
    const prediction = await this.find(userId, fixtureId);
    if (prediction === null) throw new Error('prediction vanished after submit');
    return prediction;
  }

  async find(userId: string, fixtureId: string): Promise<Prediction | null> {
    const { rows } = await this.pool.query<{ id: string; kickoff_at: Date; locked: boolean }>(
      `SELECT p.id, f.kickoff_at, (f.kickoff_at <= now()) AS locked
         FROM user_prediction p JOIN fixture f ON f.id = p.fixture_id
        WHERE p.user_id = $1 AND p.fixture_id = $2`,
      [userId, fixtureId],
    );
    const head = rows[0];
    if (head === undefined) return null;
    const versions = await this.pool.query<VersionRow>(
      `SELECT id, version_number, outcome, home_goals, away_goals, confidence, reason_tags,
              explanation, submitted_at
         FROM prediction_version WHERE prediction_id = $1 ORDER BY version_number`,
      [head.id],
    );
    const list = versions.rows.map(toVersion);
    const latest = list.at(-1);
    if (latest === undefined) return null;
    const settlement = await this.currentSettlement(head.id);
    return {
      id: head.id,
      fixture_id: fixtureId,
      locks_at: head.kickoff_at.toISOString(),
      locked: head.locked,
      latest,
      versions: list,
      settlement,
    };
  }

  /**
   * A member's predictions, newest kick-off first (T-056), with the fixture
   * as the match centre names it, every version and the current settlement.
   * `total` counts the whole history; the page is `limit` from `offset`.
   */
  async history(
    userId: string,
    limit: number,
    offset: number,
  ): Promise<{ total: number; items: PredictionHistoryItem[] }> {
    const counted = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM user_prediction WHERE user_id = $1`,
      [userId],
    );
    const total = Number(counted.rows[0]?.n ?? 0);
    if (total === 0) return { total, items: [] };

    const { rows } = await this.pool.query<{
      id: string;
      fixture_id: string;
      kickoff_at: Date;
      locked: boolean;
      status: string;
      competition_id: string;
      competition_name: string;
      home_id: string;
      home_name: string;
      home_short_name: string | null;
      away_id: string;
      away_name: string;
      away_short_name: string | null;
      score_home: number | null;
      score_away: number | null;
    }>(
      `SELECT p.id, p.fixture_id, f.kickoff_at, (f.kickoff_at <= now()) AS locked, f.status,
              c.id AS competition_id, c.name AS competition_name,
              h.team_id AS home_id, th.name AS home_name, th.short_name AS home_short_name,
              a.team_id AS away_id, ta.name AS away_name, ta.short_name AS away_short_name,
              COALESCE(ft.home, cur.home) AS score_home, COALESCE(ft.away, cur.away) AS score_away
         FROM user_prediction p
         JOIN fixture f ON f.id = p.fixture_id
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
         JOIN team th ON th.id = h.team_id
         JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
         JOIN team ta ON ta.id = a.team_id
         LEFT JOIN fixture_score ft ON ft.fixture_id = f.id AND ft.kind = 'full_time'
         LEFT JOIN fixture_score cur ON cur.fixture_id = f.id AND cur.kind = 'current'
        WHERE p.user_id = $1
        ORDER BY f.kickoff_at DESC, p.id
        LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    );
    if (rows.length === 0) return { total, items: [] };

    const ids = rows.map((r) => r.id);
    const versions = await this.pool.query<VersionRow & { prediction_id: string }>(
      `SELECT prediction_id, id, version_number, outcome, home_goals, away_goals, confidence,
              reason_tags, explanation, submitted_at
         FROM prediction_version WHERE prediction_id = ANY($1::uuid[])
        ORDER BY prediction_id, version_number`,
      [ids],
    );
    const byPrediction = new Map<string, PredictionVersion[]>();
    for (const row of versions.rows) {
      const list = byPrediction.get(row.prediction_id) ?? [];
      list.push(toVersion(row));
      byPrediction.set(row.prediction_id, list);
    }

    const items: PredictionHistoryItem[] = [];
    for (const r of rows) {
      const list = byPrediction.get(r.id) ?? [];
      const latest = list.at(-1);
      if (latest === undefined) continue;
      items.push({
        fixture: {
          id: r.fixture_id,
          kickoff_at: r.kickoff_at.toISOString(),
          status: r.status,
          competition: { id: r.competition_id, name: r.competition_name },
          home: { id: r.home_id, name: r.home_name, short_name: r.home_short_name },
          away: { id: r.away_id, name: r.away_name, short_name: r.away_short_name },
          score:
            r.score_home !== null && r.score_away !== null
              ? { home: r.score_home, away: r.score_away }
              : null,
        },
        prediction: {
          id: r.id,
          fixture_id: r.fixture_id,
          locks_at: r.kickoff_at.toISOString(),
          locked: r.locked,
          latest,
          versions: list,
          settlement: await this.currentSettlement(r.id),
        },
      });
    }
    return { total, items };
  }

  /** The newest settlement row of a prediction (T-052), or null. */
  private async currentSettlement(predictionId: string): Promise<Settlement | null> {
    const { rows } = await this.pool.query<SettlementRow>(
      `SELECT ${SETTLEMENT_COLUMNS}
         FROM settlement s JOIN prediction_version v ON v.id = s.version_id
        WHERE s.prediction_id = $1 ORDER BY s.settled_at DESC, s.id DESC LIMIT 1`,
      [predictionId],
    );
    const row = rows[0];
    return row === undefined ? null : toSettlement(row);
  }

  /**
   * What a set of members called one fixture (blueprint 8.2, T-246).
   *
   * Three queries whatever the size of the group: the calls, their versions,
   * and the newest settlement of each. The settlement is **read**, never
   * recomputed -- a comparison that scored the calls itself would be a second
   * settlement, and on the day the two disagreed there would be no saying which
   * was the product's answer (rule 8).
   */
  async callsOn(
    fixtureId: string,
    userIds: string[],
  ): Promise<{ kickoffAt: Date; locked: boolean; calls: GroupPredictionCall[] } | null> {
    const fixture = await this.pool.query<{ kickoff_at: Date; locked: boolean }>(
      `SELECT kickoff_at, (kickoff_at <= now()) AS locked FROM fixture WHERE id = $1`,
      [fixtureId],
    );
    const match = fixture.rows[0];
    if (match === undefined) return null;
    if (userIds.length === 0) {
      return { kickoffAt: match.kickoff_at, locked: match.locked, calls: [] };
    }

    const { rows: predictions } = await this.pool.query<{
      id: string;
      username: string;
      display_name: string;
    }>(
      `SELECT p.id, u.username, u.display_name
         FROM user_prediction p
         JOIN user_account u ON u.id = p.user_id
        WHERE p.fixture_id = $1 AND p.user_id = ANY($2::uuid[]) AND u.status = 'active'`,
      [fixtureId, userIds],
    );
    if (predictions.length === 0) {
      return { kickoffAt: match.kickoff_at, locked: match.locked, calls: [] };
    }

    const ids = predictions.map((row) => row.id);
    const [versions, settlements] = await Promise.all([
      this.pool.query<VersionRow & { prediction_id: string; revisions: string }>(
        `SELECT DISTINCT ON (prediction_id)
                prediction_id, id, version_number, outcome, home_goals, away_goals, confidence,
                reason_tags, explanation, submitted_at,
                count(*) OVER (PARTITION BY prediction_id)::text AS revisions
           FROM prediction_version
          WHERE prediction_id = ANY($1::uuid[])
          ORDER BY prediction_id, version_number DESC`,
        [ids],
      ),
      this.pool.query<SettlementRow & { prediction_id: string }>(
        `SELECT DISTINCT ON (s.prediction_id) s.prediction_id, ${SETTLEMENT_COLUMNS}
           FROM settlement s JOIN prediction_version v ON v.id = s.version_id
          WHERE s.prediction_id = ANY($1::uuid[])
          ORDER BY s.prediction_id, s.settled_at DESC, s.id DESC`,
        [ids],
      ),
    ]);

    const heads = new Map(versions.rows.map((row) => [row.prediction_id, row]));
    const settled = new Map(settlements.rows.map((row) => [row.prediction_id, row]));
    const calls: GroupPredictionCall[] = [];
    for (const row of predictions) {
      const head = heads.get(row.id);
      // A prediction with no version cannot happen -- the first version is
      // written with it -- and if it ever did, the member has called nothing.
      if (head === undefined) continue;
      const settlement = settled.get(row.id);
      calls.push({
        username: row.username,
        display_name: row.display_name,
        version: toVersion(head),
        revisions: Number(head.revisions),
        settlement: settlement === undefined ? null : toSettlement(settlement),
      });
    }
    calls.sort(
      (a, b) =>
        b.version.confidence - a.version.confidence ||
        a.version.submitted_at.localeCompare(b.version.submitted_at) ||
        a.username.localeCompare(b.username),
    );
    return { kickoffAt: match.kickoff_at, locked: match.locked, calls };
  }
}
