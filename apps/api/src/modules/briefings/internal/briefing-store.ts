import { Inject, Injectable } from '@nestjs/common';
import type { BriefingDigest } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

export interface BriefingRow {
  version_number: number;
  since: Date;
  until: Date;
  language: string;
  text: string;
  prompt_version: string;
  model: string;
  generated_at: Date;
}

export interface NewBriefing {
  userId: string;
  since: string;
  until: string;
  state: 'published' | 'rejected';
  text: string | null;
  rejection: string | null;
  document: BriefingDigest;
  promptVersion: string;
  model: string;
}

/** Briefing versions (T-431): a member's own, written once, read by them. */
@Injectable()
export class PostgresBriefingStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async latestPublished(userId: string): Promise<BriefingRow | null> {
    const { rows } = await this.pool.query<BriefingRow>(
      `SELECT version_number, since, until, language, text, prompt_version, model, generated_at
         FROM member_briefing
        WHERE user_id = $1 AND state = 'published'
        ORDER BY version_number DESC
        LIMIT 1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async versions(userId: string): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM member_briefing WHERE user_id = $1`,
      [userId],
    );
    return rows[0]?.n ?? 0;
  }

  async add(briefing: NewBriefing): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT 1 FROM user_account WHERE id = $1 FOR UPDATE`, [briefing.userId]);
      const next = await client.query<{ n: number }>(
        `SELECT COALESCE(max(version_number), 0) + 1 AS n FROM member_briefing WHERE user_id = $1`,
        [briefing.userId],
      );
      const number = next.rows[0]?.n ?? 1;
      await client.query(
        `INSERT INTO member_briefing
           (user_id, version_number, since, until, state, text, rejection, document, prompt_version, model)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)`,
        [
          briefing.userId,
          number,
          briefing.since,
          briefing.until,
          briefing.state,
          briefing.text,
          briefing.rejection,
          JSON.stringify(briefing.document),
          briefing.promptVersion,
          briefing.model,
        ],
      );
      await client.query('COMMIT');
      return number;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
