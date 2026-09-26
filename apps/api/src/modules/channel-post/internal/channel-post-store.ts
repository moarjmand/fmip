import { Inject, Injectable } from '@nestjs/common';
import type { ChannelPostState } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { DailyPost } from './daily-post';

export interface ChannelPostRecord {
  day: string;
  state: ChannelPostState;
  messages: string[];
  delivered: number;
  attempts: number;
  finishedAt: string | null;
  failure: string | null;
}

interface Row {
  day: string;
  state: ChannelPostState;
  messages: string[];
  delivered: number;
  attempts: number;
  finished_at: Date | null;
  failure: string | null;
}

const COLUMNS = `day::text AS day, state, messages, delivered, attempts, finished_at, failure`;

function toRecord(row: Row): ChannelPostRecord {
  return {
    day: row.day,
    state: row.state,
    messages: row.messages,
    delivered: row.delivered,
    attempts: row.attempts,
    finishedAt: row.finished_at?.toISOString() ?? null,
    failure: row.failure,
  };
}

/**
 * `channel_post` (T-525): one row per day, the primary key being the whole
 * of "at most once". Every statement the module runs is here.
 */
@Injectable()
export class PostgresChannelPostStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async get(day: string): Promise<ChannelPostRecord | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM channel_post WHERE day = $1::date`,
      [day],
    );
    return rows[0] === undefined ? null : toRecord(rows[0]);
  }

  async latest(): Promise<ChannelPostRecord | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM channel_post ORDER BY day DESC LIMIT 1`,
    );
    return rows[0] === undefined ? null : toRecord(rows[0]);
  }

  /**
   * Claims the day for this post, or returns false when it is not this
   * caller's to post: a row already there, claimed, sent or failed. The one
   * exception is a `refused` day, which the channel answered by posting
   * nothing, so it is taken over with the new text and counted as another
   * attempt. Two instances racing for the same day both reach the row lock,
   * and the loser re-reads the winner's `sending` and gets false.
   */
  async claim(post: DailyPost, provider: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO channel_post (day, provider, messages, fixtures, forecasts, model_versions)
            VALUES ($1::date, $2, $3::text[], $4, $5, $6::text[])
       ON CONFLICT (day) DO UPDATE
             SET provider = EXCLUDED.provider,
                 state = 'sending',
                 messages = EXCLUDED.messages,
                 delivered = 0,
                 fixtures = EXCLUDED.fixtures,
                 forecasts = EXCLUDED.forecasts,
                 model_versions = EXCLUDED.model_versions,
                 attempts = channel_post.attempts + 1,
                 claimed_at = now(),
                 finished_at = NULL,
                 failure = NULL
           WHERE channel_post.state = 'refused'`,
      [post.day, provider, post.messages, post.fixtures, post.forecasts, post.modelVersions],
    );
    return rowCount === 1;
  }

  /** One more message accepted by the channel. */
  async delivered(day: string): Promise<void> {
    await this.pool.query(
      `UPDATE channel_post SET delivered = delivered + 1 WHERE day = $1::date AND state = 'sending'`,
      [day],
    );
  }

  async finish(day: string, state: 'sent'): Promise<void>;
  async finish(day: string, state: 'refused' | 'failed', failure: string): Promise<void>;
  async finish(day: string, state: 'sent' | 'refused' | 'failed', failure?: string): Promise<void> {
    await this.pool.query(
      `UPDATE channel_post SET state = $2, failure = $3, finished_at = now()
        WHERE day = $1::date AND state = 'sending'`,
      [day, state, failure ?? null],
    );
  }
}
