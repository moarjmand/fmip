import { Inject, Injectable } from '@nestjs/common';
import type { NewsSourceKind, NewsSourceRecord, NewsSourceRights } from '@fmip/contracts';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/** The fields an administrator sets on a source. */
export interface NewsSourceFields {
  name: string;
  homepage_url: string;
  feed_url: string;
  kind: NewsSourceKind;
  rights: NewsSourceRights;
  language: string;
}

interface Row {
  id: string;
  name: string;
  homepage_url: string;
  feed_url: string | null;
  kind: NewsSourceRecord['kind'];
  rights: NewsSourceRecord['rights'];
  language: string;
  created_at: Date;
  updated_at: Date;
  dropped_at: Date | null;
  dropped_reason: string | null;
  fetch_status: NonNullable<NewsSourceRecord['last_fetch']>['status'] | null;
  fetch_started_at: Date | null;
  fetch_finished_at: Date | null;
  items_seen: number | null;
  items_written: number | null;
  fetch_error: string | null;
}

const SELECT = `
  SELECT s.id, s.name, s.homepage_url, s.feed_url, s.kind, s.rights, s.language,
         s.created_at, s.updated_at, s.dropped_at, s.dropped_reason,
         f.status AS fetch_status, f.started_at AS fetch_started_at,
         f.finished_at AS fetch_finished_at, f.items_seen, f.items_written, f.error AS fetch_error
    FROM news_source s
    LEFT JOIN LATERAL (
      SELECT status, started_at, finished_at, items_seen, items_written, error
        FROM news_fetch WHERE source_id = s.id ORDER BY started_at DESC LIMIT 1
    ) f ON true`;

function record(row: Row): NewsSourceRecord {
  return {
    id: row.id,
    name: row.name,
    homepage_url: row.homepage_url,
    feed_url: row.feed_url,
    kind: row.kind,
    rights: row.rights,
    language: row.language,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    dropped_at: row.dropped_at?.toISOString() ?? null,
    dropped_reason: row.dropped_reason,
    last_fetch:
      row.fetch_status === null || row.fetch_started_at === null
        ? null
        : {
            status: row.fetch_status,
            started_at: row.fetch_started_at.toISOString(),
            finished_at: row.fetch_finished_at?.toISOString() ?? null,
            items_seen: row.items_seen ?? 0,
            items_written: row.items_written ?? 0,
            error: row.fetch_error,
          },
  };
}

/** What the audit row keeps of a source: the fields an administrator sets, and the drop. */
function audited(row: Row | NewsSourceRecord): Record<string, unknown> {
  const at = (value: Date | string | null) =>
    value === null ? null : typeof value === 'string' ? value : value.toISOString();
  return {
    name: row.name,
    homepage_url: row.homepage_url,
    feed_url: row.feed_url,
    kind: row.kind,
    rights: row.rights,
    language: row.language,
    dropped_at: at(row.dropped_at),
    dropped_reason: row.dropped_reason,
  };
}

export type EditOutcome =
  | { kind: 'no_source' }
  | { kind: 'dropped' }
  | { kind: 'unchanged' }
  | { kind: 'edited'; source: NewsSourceRecord; auditId: string };

export type DropOutcome =
  | { kind: 'no_source' }
  | { kind: 'already'; source: NewsSourceRecord }
  | { kind: 'dropped'; source: NewsSourceRecord; auditId: string };

/**
 * News sources in the console (T-1015): the `news_source` rows with each
 * one's newest fetch, and the three writes -- add, edit, drop -- each with its
 * `audit_log` row (target type `news_source`, the reason, the previous and
 * the next value) in the same transaction (rule 10). A drop keeps the row,
 * dated with the reason, as the schema intends (D-061); nothing is deleted.
 */
@Injectable()
export class PostgresNewsSourcesAdminStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(): Promise<NewsSourceRecord[]> {
    const { rows } = await this.pool.query<Row>(
      `${SELECT} ORDER BY s.dropped_at IS NOT NULL, s.dropped_at DESC, s.name, s.id`,
    );
    return rows.map(record);
  }

  async get(id: string): Promise<NewsSourceRecord | null> {
    const { rows } = await this.pool.query<Row>(`${SELECT} WHERE s.id = $1`, [id]);
    return rows[0] === undefined ? null : record(rows[0]);
  }

  /** Whether a carried source other than `exceptId` already reads this feed. */
  async feedTaken(feedUrl: string, exceptId: string | null): Promise<boolean> {
    const { rows } = await this.pool.query<{ taken: boolean }>(
      `SELECT EXISTS (
         SELECT 1 FROM news_source
          WHERE feed_url = $1 AND dropped_at IS NULL AND ($2::uuid IS NULL OR id <> $2)
       ) AS taken`,
      [feedUrl, exceptId],
    );
    return rows[0]?.taken === true;
  }

  async add(
    actorId: string,
    fields: NewsSourceFields,
    reason: string,
  ): Promise<{ source: NewsSourceRecord; auditId: string }> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [
          fields.name,
          fields.homepage_url,
          fields.feed_url,
          fields.kind,
          fields.rights,
          fields.language,
        ],
      );
      const source = await this.read(client, rows[0]!.id);
      const auditId = await this.audit(client, {
        actorId,
        action: 'news_source.add',
        targetId: source.id,
        reason,
        previous: null,
        next: audited(source),
      });
      return { source, auditId };
    });
  }

  async edit(
    actorId: string,
    id: string,
    changes: Partial<NewsSourceFields>,
    reason: string,
  ): Promise<EditOutcome> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<Row>(`${SELECT} WHERE s.id = $1 FOR UPDATE OF s`, [id]);
      const before = rows[0];
      if (before === undefined) return { kind: 'no_source' };
      if (before.dropped_at !== null) return { kind: 'dropped' };
      const next = { ...before, ...changes };
      const keys = [
        'name',
        'homepage_url',
        'feed_url',
        'kind',
        'rights',
        'language',
      ] as const satisfies readonly (keyof NewsSourceFields)[];
      if (keys.every((key) => next[key] === before[key])) return { kind: 'unchanged' };
      await client.query(
        `UPDATE news_source
            SET name = $2, homepage_url = $3, feed_url = $4, kind = $5, rights = $6, language = $7
          WHERE id = $1`,
        [id, next.name, next.homepage_url, next.feed_url, next.kind, next.rights, next.language],
      );
      const source = await this.read(client, id);
      const auditId = await this.audit(client, {
        actorId,
        action: 'news_source.edit',
        targetId: id,
        reason,
        previous: audited(before),
        next: audited(source),
      });
      return { kind: 'edited', source, auditId };
    });
  }

  async drop(actorId: string, id: string, reason: string): Promise<DropOutcome> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<Row>(`${SELECT} WHERE s.id = $1 FOR UPDATE OF s`, [id]);
      const before = rows[0];
      if (before === undefined) return { kind: 'no_source' };
      if (before.dropped_at !== null) return { kind: 'already', source: record(before) };
      await client.query(
        `UPDATE news_source SET dropped_at = now(), dropped_reason = $2 WHERE id = $1`,
        [id, reason],
      );
      const source = await this.read(client, id);
      const auditId = await this.audit(client, {
        actorId,
        action: 'news_source.drop',
        targetId: id,
        reason,
        previous: audited(before),
        next: audited(source),
      });
      return { kind: 'dropped', source, auditId };
    });
  }

  private async read(client: PoolClient, id: string): Promise<NewsSourceRecord> {
    const { rows } = await client.query<Row>(`${SELECT} WHERE s.id = $1`, [id]);
    return record(rows[0]!);
  }

  private async audit(
    client: PoolClient,
    entry: {
      actorId: string;
      action: string;
      targetId: string;
      reason: string;
      previous: Record<string, unknown> | null;
      next: Record<string, unknown>;
    },
  ): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
       VALUES ($1, $2, 'news_source', $3, $4, $5::jsonb, $6::jsonb) RETURNING id`,
      [
        entry.actorId,
        entry.action,
        entry.targetId,
        entry.reason,
        entry.previous === null ? null : JSON.stringify(entry.previous),
        JSON.stringify(entry.next),
      ],
    );
    return rows[0]!.id;
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
