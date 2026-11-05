import { Inject, Injectable } from '@nestjs/common';
import type { PendingPick, PendingPickStatus, PredictionOutcome } from '@fmip/contracts';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import { savePlan } from './pending-pick';

/** SQLSTATE raised by `refuse_pending_pick_not_open()` (migration 1765901300000); the hint says why. */
export const NOT_OPEN_SQLSTATE = 'PL023';
/** SQLSTATE raised by `refuse_over_rate()` (T-213). */
export const OVER_RATE_SQLSTATE = 'PL005';

/** Why the database refused to take a pending pick. */
export class PendingPickRefusedError extends Error {
  constructor(readonly reason: 'locked' | 'email_verified' | 'rate_limited') {
    super(`pending pick refused: ${reason}`);
    this.name = 'PendingPickRefusedError';
  }
}

/** A pick still waiting, as a confirmation reads it. */
export interface WaitingPick {
  id: string;
  fixtureId: string;
  outcome: PredictionOutcome;
}

/** What became of the waiting picks of one member in one confirmation. */
export interface ResolvedPicks {
  converted: number;
  expired: number;
  /** Left waiting because writing the prediction failed; the error is logged by the caller. */
  left: number;
}

/**
 * What the pending-pick service needs of its store. The service is written
 * against this, so its rules are tested without a database
 * (`pending-pick.spec.ts`).
 */
export interface PendingPickStore {
  kickoffOf(fixtureId: string): Promise<Date | null>;
  newest(userId: string, fixtureId: string): Promise<PendingPick | null>;
  save(userId: string, fixtureId: string, outcome: PredictionOutcome): Promise<void>;
  withdraw(userId: string, fixtureId: string): Promise<boolean>;
  resolveWaiting(
    userId: string,
    decide: (pick: WaitingPick) => Promise<'converted' | 'expired'>,
    failed: (pick: WaitingPick, error: unknown) => void,
  ): Promise<ResolvedPicks>;
}

interface PickRow {
  id: string;
  fixture_id: string;
  outcome: PredictionOutcome;
  status: PendingPickStatus;
  created_at: Date;
  resolved_at: Date | null;
  kickoff_at: Date;
}

const toPick = (row: PickRow): PendingPick => ({
  id: row.id,
  fixture_id: row.fixture_id,
  outcome: row.outcome,
  status: row.status,
  saved_at: row.created_at.toISOString(),
  resolved_at: row.resolved_at === null ? null : row.resolved_at.toISOString(),
  counts_before: row.kickoff_at.toISOString(),
});

function refusal(error: unknown): PendingPickRefusedError | null {
  const { code, hint } = (error ?? {}) as { code?: string; hint?: string };
  if (code === OVER_RATE_SQLSTATE) return new PendingPickRefusedError('rate_limited');
  if (code !== NOT_OPEN_SQLSTATE) return null;
  if (hint === 'kickoff') return new PendingPickRefusedError('locked');
  if (hint === 'verified') return new PendingPickRefusedError('email_verified');
  return null;
}

/**
 * The SQL of pending picks (T-1740, D-361): the `pending_pick` rows, and
 * nothing of a prediction's. Who may leave one, until when, and how often are
 * also the schema's rules (`pending_pick_open_guard`, PL023, on the
 * database's clock; `pending_pick_volume_guard`, PL005); what was chosen is
 * never rewritten (`pending_pick_fixed`, PL007).
 */
@Injectable()
export class PostgresPendingPickStore implements PendingPickStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The match's kick-off, or null when there is no such match. */
  async kickoffOf(fixtureId: string): Promise<Date | null> {
    const { rows } = await this.pool.query<{ kickoff_at: Date }>(
      `SELECT kickoff_at FROM fixture WHERE id = $1`,
      [fixtureId],
    );
    return rows[0]?.kickoff_at ?? null;
  }

  /**
   * The member's pick on the match as it stands: the one waiting if there is
   * one, else the newest, whatever became of it. A pick still stored as
   * waiting once the match has kicked off reads `expired`, on the database's
   * clock.
   */
  async newest(userId: string, fixtureId: string): Promise<PendingPick | null> {
    const { rows } = await this.pool.query<PickRow>(
      `SELECT pp.id, pp.fixture_id, pp.outcome,
              CASE WHEN pp.status = 'pending' AND f.kickoff_at <= now()
                   THEN 'expired' ELSE pp.status END AS status,
              pp.created_at, pp.resolved_at, f.kickoff_at
         FROM pending_pick pp
         JOIN fixture f ON f.id = pp.fixture_id
        WHERE pp.user_id = $1 AND pp.fixture_id = $2
        ORDER BY (pp.status = 'pending') DESC, pp.created_at DESC, pp.id DESC
        LIMIT 1`,
      [userId, fixtureId],
    );
    const row = rows[0];
    return row === undefined ? null : toPick(row);
  }

  /**
   * Leaves `outcome` waiting on the match. One transaction under a lock per
   * member and match, so two taps at once make one waiting pick: the same
   * outcome again changes nothing; another outcome resolves the waiting pick
   * as replaced and adds the new one (`savePlan`). The insert is where the
   * database refuses a match that has kicked off, a member whose address is
   * confirmed, and a member over the ceiling.
   */
  async save(userId: string, fixtureId: string, outcome: PredictionOutcome): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `SELECT pg_advisory_xact_lock(hashtext('pending_pick:' || $1::text || ':' || $2::text))`,
        [userId, fixtureId],
      );
      const { rows } = await client.query<{ outcome: PredictionOutcome }>(
        `SELECT outcome FROM pending_pick
          WHERE user_id = $1 AND fixture_id = $2 AND status = 'pending'`,
        [userId, fixtureId],
      );
      const plan = savePlan(rows[0] ?? null, outcome);
      if (plan === 'replace') {
        await client.query(
          `UPDATE pending_pick SET status = 'replaced', resolved_at = clock_timestamp()
            WHERE user_id = $1 AND fixture_id = $2 AND status = 'pending'`,
          [userId, fixtureId],
        );
      }
      if (plan !== 'keep') {
        await client.query(
          `INSERT INTO pending_pick (user_id, fixture_id, outcome) VALUES ($1, $2, $3)`,
          [userId, fixtureId, outcome],
        );
      }
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw refusal(error) ?? error;
    } finally {
      client.release();
    }
  }

  /**
   * The member takes back the pick waiting on a match that has not kicked
   * off. False when none was waiting (after kick-off it is no longer waiting:
   * it stays, saved and not counted).
   */
  async withdraw(userId: string, fixtureId: string): Promise<boolean> {
    const result = await this.pool.query(
      `UPDATE pending_pick pp SET status = 'withdrawn', resolved_at = clock_timestamp()
        WHERE pp.user_id = $1 AND pp.fixture_id = $2 AND pp.status = 'pending'
          AND EXISTS (SELECT 1 FROM fixture f WHERE f.id = pp.fixture_id AND f.kickoff_at > now())`,
      [userId, fixtureId],
    );
    return (result.rowCount ?? 0) > 0;
  }

  /**
   * Every pick of the member still waiting, each handed to `decide` and
   * resolved as it answers, oldest first. The rows are locked for the length
   * of the run, so a second run at the same moment waits and then finds
   * nothing waiting: a pick is decided once. `decide` writes through another
   * connection (the predictions boundary's own path); if it throws, that pick
   * is left waiting, `failed` is told, and the others are still decided.
   */
  async resolveWaiting(
    userId: string,
    decide: (pick: WaitingPick) => Promise<'converted' | 'expired'>,
    failed: (pick: WaitingPick, error: unknown) => void,
  ): Promise<ResolvedPicks> {
    const done: ResolvedPicks = { converted: 0, expired: 0, left: 0 };
    const client: PoolClient = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{
        id: string;
        fixture_id: string;
        outcome: PredictionOutcome;
      }>(
        `SELECT id, fixture_id, outcome FROM pending_pick
          WHERE user_id = $1 AND status = 'pending'
          ORDER BY created_at, id
            FOR UPDATE`,
        [userId],
      );
      for (const row of rows) {
        const pick: WaitingPick = { id: row.id, fixtureId: row.fixture_id, outcome: row.outcome };
        let status: 'converted' | 'expired';
        try {
          status = await decide(pick);
        } catch (error: unknown) {
          done.left += 1;
          failed(pick, error);
          continue;
        }
        await client.query(
          `UPDATE pending_pick SET status = $2, resolved_at = clock_timestamp() WHERE id = $1`,
          [pick.id, status],
        );
        done[status] += 1;
      }
      await client.query('COMMIT');
      return done;
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
