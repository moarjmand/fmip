import { Inject, Injectable } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/** Postgres' unique_violation and the article schema's rights guard (T-141). */
const RIGHTS = 'PL016';

export interface TranslationFields {
  language: string;
  headline: string;
  summary: string | null;
  byline: string | null;
}

export type TranslateOutcome =
  | { kind: 'written'; versionNumber: number }
  | { kind: 'no_article' }
  /** The publisher already writes in this language; a translation into it would be a second original. */
  | { kind: 'publisher_language' }
  /** More than the source grants (a summary from a headline-only source). */
  | { kind: 'rights' };

export type ReviewOutcome =
  | { kind: 'reviewed'; versionNumber: number }
  | { kind: 'nothing_to_review' }
  | { kind: 'already_reviewed' }
  /** A translation is reviewed by a second fluent speaker, never by its author. */
  | { kind: 'same_person' };

interface AuditEntry {
  actorId: string;
  action: string;
  targetId: string;
  reason: string;
  previous: Record<string, unknown> | null;
  next: Record<string, unknown>;
}

/**
 * A person's language version of an article (T-304): written as a new
 * version with `origin = 'translation'`, reviewed as another new version
 * naming a second person. Never an edit (rule 5), never a machine's words
 * (T-151), never more than the source grants (D-061), and every decision an
 * `audit_log` row in the same transaction (rule 10).
 */
@Injectable()
export class PostgresTranslationsAdminStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async translate(
    articleId: string,
    actorId: string,
    fields: TranslationFields,
  ): Promise<TranslateOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const article = await client.query<{ id: string }>(
        `SELECT a.id FROM article a JOIN news_source s ON s.id = a.source_id
          WHERE a.id = $1 AND s.dropped_at IS NULL FOR UPDATE`,
        [articleId],
      );
      if (article.rows.length === 0) {
        await client.query('ROLLBACK');
        return { kind: 'no_article' };
      }
      const original = await client.query(
        `SELECT 1 FROM article_version
          WHERE article_id = $1 AND language = $2 AND origin = 'publisher'`,
        [articleId, fields.language],
      );
      if ((original.rowCount ?? 0) > 0) {
        await client.query('ROLLBACK');
        return { kind: 'publisher_language' };
      }
      const next = await client.query<{ n: number }>(
        `SELECT COALESCE(max(version_number), 0)::int + 1 AS n
           FROM article_version WHERE article_id = $1 AND language = $2`,
        [articleId, fields.language],
      );
      const versionNumber = next.rows[0]!.n;
      const previous = await client.query<{ headline: string; review_state: string | null }>(
        `SELECT headline, review_state FROM article_version
          WHERE article_id = $1 AND language = $2
          ORDER BY version_number DESC LIMIT 1`,
        [articleId, fields.language],
      );
      await client.query(
        `INSERT INTO article_version
           (article_id, language, version_number, headline, summary, byline, published_at,
            origin, review_state, written_by)
         SELECT $1, $2, $3, $4, $5, $6,
                (SELECT min(published_at) FROM article_version WHERE article_id = $1),
                'translation', 'translated', $7`,
        [
          articleId,
          fields.language,
          versionNumber,
          fields.headline,
          fields.summary,
          fields.byline,
          actorId,
        ],
      );
      const last = previous.rows[0];
      await record(client, {
        actorId,
        action: 'translation.write',
        targetId: articleId,
        reason: `translation into ${fields.language}`,
        previous:
          last === undefined
            ? null
            : {
                language: fields.language,
                headline: last.headline,
                review_state: last.review_state,
              },
        next: {
          language: fields.language,
          version_number: versionNumber,
          headline: fields.headline,
          review_state: 'translated',
        },
      });
      await client.query('COMMIT');
      return { kind: 'written', versionNumber };
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      if ((error as { code?: string }).code === RIGHTS) return { kind: 'rights' };
      throw error;
    } finally {
      client.release();
    }
  }

  async review(articleId: string, language: string, actorId: string): Promise<ReviewOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const newest = await client.query<{
        version_number: number;
        headline: string;
        summary: string | null;
        byline: string | null;
        published_at: Date | null;
        review_state: string | null;
        written_by: string | null;
      }>(
        `SELECT version_number, headline, summary, byline, published_at, review_state, written_by
           FROM article_version
          WHERE article_id = $1 AND language = $2 AND origin = 'translation'
          ORDER BY version_number DESC LIMIT 1 FOR UPDATE`,
        [articleId, language],
      );
      const current = newest.rows[0];
      if (current === undefined) {
        await client.query('ROLLBACK');
        return { kind: 'nothing_to_review' };
      }
      if (current.review_state === 'reviewed') {
        await client.query('ROLLBACK');
        return { kind: 'already_reviewed' };
      }
      if (current.written_by === actorId) {
        await client.query('ROLLBACK');
        return { kind: 'same_person' };
      }
      const versionNumber = current.version_number + 1;
      await client.query(
        `INSERT INTO article_version
           (article_id, language, version_number, headline, summary, byline, published_at,
            origin, review_state, written_by, reviewed_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'translation', 'reviewed', $8, $9)`,
        [
          articleId,
          language,
          versionNumber,
          current.headline,
          current.summary,
          current.byline,
          current.published_at,
          current.written_by,
          actorId,
        ],
      );
      await record(client, {
        actorId,
        action: 'translation.review',
        targetId: articleId,
        reason: `review of the ${language} translation`,
        previous: { language, version_number: current.version_number, review_state: 'translated' },
        next: { language, version_number: versionNumber, review_state: 'reviewed' },
      });
      await client.query('COMMIT');
      return { kind: 'reviewed', versionNumber };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function record(client: PoolClient, entry: AuditEntry): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
     VALUES ($1, $2, 'article', $3, $4, $5::jsonb, $6::jsonb)`,
    [
      entry.actorId,
      entry.action,
      entry.targetId,
      entry.reason,
      entry.previous === null ? null : JSON.stringify(entry.previous),
      JSON.stringify(entry.next),
    ],
  );
}
