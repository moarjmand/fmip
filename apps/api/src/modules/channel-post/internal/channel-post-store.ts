import { Inject, Injectable } from '@nestjs/common';
import type { ChannelPostKind, ChannelPostState } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import type { DailyPost } from './daily-post';

export interface ChannelPostRecord {
  kind: ChannelPostKind;
  day: string;
  state: ChannelPostState;
  messages: string[];
  delivered: number;
  attempts: number;
  finishedAt: string | null;
  failure: string | null;
}

interface Row {
  kind: ChannelPostKind;
  day: string;
  state: ChannelPostState;
  messages: string[];
  delivered: number;
  attempts: number;
  finished_at: Date | null;
  failure: string | null;
}

const COLUMNS = `kind, day::text AS day, state, messages, delivered, attempts, finished_at, failure`;

function toRecord(row: Row): ChannelPostRecord {
  return {
    kind: row.kind,
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
 * `channel_post` (T-525): one row per kind of post and day (T-1430), the
 * primary key being the whole of "at most once". Every statement the module
 * runs is here.
 */
@Injectable()
export class PostgresChannelPostStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async get(kind: ChannelPostKind, day: string): Promise<ChannelPostRecord | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM channel_post WHERE kind = $1 AND day = $2::date`,
      [kind, day],
    );
    return rows[0] === undefined ? null : toRecord(rows[0]);
  }

  async latest(kind: ChannelPostKind): Promise<ChannelPostRecord | null> {
    const { rows } = await this.pool.query<Row>(
      `SELECT ${COLUMNS} FROM channel_post WHERE kind = $1 ORDER BY day DESC LIMIT 1`,
      [kind],
    );
    return rows[0] === undefined ? null : toRecord(rows[0]);
  }

  /**
   * Claims the kind's day for this post, or returns false when it is not
   * this caller's to post: a row already there, claimed, sent or failed. The
   * one exception is a `refused` day, which the channel answered by posting
   * nothing, so it is taken over with the new text and counted as another
   * attempt. Two instances racing for the same day both reach the row lock,
   * and the loser re-reads the winner's `sending` and gets false.
   */
  async claim(kind: ChannelPostKind, post: DailyPost, provider: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO channel_post (kind, day, provider, messages, fixtures, forecasts, model_versions)
            VALUES ($1, $2::date, $3, $4::text[], $5, $6, $7::text[])
       ON CONFLICT (kind, day) DO UPDATE
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
      [kind, post.day, provider, post.messages, post.fixtures, post.forecasts, post.modelVersions],
    );
    return rowCount === 1;
  }

  /** One more message accepted by the channel. */
  async delivered(kind: ChannelPostKind, day: string): Promise<void> {
    await this.pool.query(
      `UPDATE channel_post SET delivered = delivered + 1
        WHERE kind = $1 AND day = $2::date AND state = 'sending'`,
      [kind, day],
    );
  }

  async finish(kind: ChannelPostKind, day: string, state: 'sent'): Promise<void>;
  async finish(
    kind: ChannelPostKind,
    day: string,
    state: 'refused' | 'failed',
    failure: string,
  ): Promise<void>;
  async finish(
    kind: ChannelPostKind,
    day: string,
    state: 'sent' | 'refused' | 'failed',
    failure?: string,
  ): Promise<void> {
    await this.pool.query(
      `UPDATE channel_post SET state = $3, failure = $4, finished_at = now()
        WHERE kind = $1 AND day = $2::date AND state = 'sending'`,
      [kind, day, state, failure ?? null],
    );
  }
}
