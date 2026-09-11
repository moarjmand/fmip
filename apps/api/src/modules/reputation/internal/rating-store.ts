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
