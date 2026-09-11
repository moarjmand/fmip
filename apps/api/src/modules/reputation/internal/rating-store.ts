import { Inject, Injectable } from '@nestjs/common';
import type { RatingComponents, RatingTier } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

export interface SnapshotRow {
  id: string;
  formulaVersion: string;
  settledCount: number;
  rating: number;
  components: RatingComponents;
  provisional: boolean;
  established: boolean;
  inputsHash: string;
  computedAt: string;
}

export interface NewSnapshot {
  userId: string;
  formulaVersion: string;
  settledCount: number;
  rating: number;
  components: RatingComponents;
  provisional: boolean;
  established: boolean;
  inputsHash: string;
}

export interface BoardRow {
  rank: number;
  username: string;
  rating: number;
  settledCount: number;
  provisional: boolean;
  established: boolean;
  formulaVersion: string;
  computedAt: string;
}

export interface BoardPage {
  total: number;
  rows: BoardRow[];
}

/** SQL for rating snapshots (D-025). Insert-only; the newest per user is current. */
@Injectable()
export class PostgresRatingStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async latest(userId: string): Promise<SnapshotRow | null> {
    const { rows } = await this.pool.query<{
      id: string;
      formula_version: string;
      settled_count: number;
      rating: string;
      components: RatingComponents;
      provisional: boolean;
      established: boolean;
      inputs_hash: string;
      computed_at: Date;
    }>(
      `SELECT id, formula_version, settled_count, rating, components, provisional, established,
              inputs_hash, computed_at
         FROM rating_snapshot WHERE user_id = $1
        ORDER BY computed_at DESC, id DESC LIMIT 1`,
      [userId],
    );
    const r = rows[0];
    if (r === undefined) return null;
    return {
      id: r.id,
      formulaVersion: r.formula_version,
      settledCount: r.settled_count,
      rating: Number(r.rating),
      components: r.components,
      provisional: r.provisional,
      established: r.established,
      inputsHash: r.inputs_hash,
      computedAt: r.computed_at.toISOString(),
    };
  }

  async insert(snapshot: NewSnapshot): Promise<SnapshotRow> {
    const { rows } = await this.pool.query<{ id: string; computed_at: Date }>(
      `INSERT INTO rating_snapshot
         (user_id, formula_version, settled_count, rating, components, provisional, established, inputs_hash)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)
       RETURNING id, computed_at`,
      [
        snapshot.userId,
        snapshot.formulaVersion,
        snapshot.settledCount,
        snapshot.rating,
        JSON.stringify(snapshot.components),
        snapshot.provisional,
        snapshot.established,
        snapshot.inputsHash,
      ],
    );
    const r = rows[0];
    if (r === undefined) throw new Error('rating_snapshot insert returned no row');
    return {
      id: r.id,
      formulaVersion: snapshot.formulaVersion,
      settledCount: snapshot.settledCount,
      rating: snapshot.rating,
      components: snapshot.components,
      provisional: snapshot.provisional,
      established: snapshot.established,
      inputsHash: snapshot.inputsHash,
      computedAt: r.computed_at.toISOString(),
    };
  }

  /**
   * The current snapshot of every active member with at least `minSettled`
   * settled predictions, ranked by rating, then sample, then name. `total`
   * counts the whole board under the filter; the page is `limit` from
   * `offset`. Ranks are computed before paging, so page two starts where page
   * one ended.
   */
  async board(minSettled: number, limit: number, offset: number): Promise<BoardPage> {
    const { rows } = await this.pool.query<{
      rank: string;
      username: string;
      rating: string;
      settled_count: number;
      provisional: boolean;
      established: boolean;
      formula_version: string;
      computed_at: Date;
      total: string;
    }>(
      `WITH latest AS (
         SELECT DISTINCT ON (s.user_id)
                s.user_id, s.rating, s.settled_count, s.provisional, s.established,
                s.formula_version, s.computed_at
           FROM rating_snapshot s
          ORDER BY s.user_id, s.computed_at DESC, s.id DESC
       ), ranked AS (
         SELECT l.rating, l.settled_count, l.provisional, l.established, l.formula_version,
                l.computed_at, u.username,
                rank() OVER (ORDER BY l.rating DESC, l.settled_count DESC, u.username ASC) AS rank
           FROM latest l
           JOIN user_account u ON u.id = l.user_id
          WHERE l.settled_count >= $1 AND u.status = 'active'
       )
       SELECT rank::text, username, rating, settled_count, provisional, established,
              formula_version, computed_at, count(*) OVER ()::text AS total
         FROM ranked
        ORDER BY rank
        LIMIT $2 OFFSET $3`,
      [minSettled, limit, offset],
    );
    let total = Number(rows[0]?.total ?? 0);
    if (rows.length === 0 && offset > 0) {
      // Past the end: the window count is gone with the rows, so count again.
      const counted = await this.pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM (
           SELECT DISTINCT ON (s.user_id) s.user_id, s.settled_count
             FROM rating_snapshot s ORDER BY s.user_id, s.computed_at DESC, s.id DESC
         ) l JOIN user_account u ON u.id = l.user_id
         WHERE l.settled_count >= $1 AND u.status = 'active'`,
        [minSettled],
      );
      total = Number(counted.rows[0]?.n ?? 0);
    }
    return {
      total,
      rows: rows.map((r) => ({
        rank: Number(r.rank),
        username: r.username,
        rating: Number(r.rating),
        settledCount: r.settled_count,
        provisional: r.provisional,
        established: r.established,
        formulaVersion: r.formula_version,
        computedAt: r.computed_at.toISOString(),
      })),
    };
  }

  /** How many snapshots a member has: the history of real rating changes. */
  async count(userId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM rating_snapshot WHERE user_id = $1`,
      [userId],
    );
    return Number(rows[0]?.n ?? 0);
  }
}

export type { RatingTier };
