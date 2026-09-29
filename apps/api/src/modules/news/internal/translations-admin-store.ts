import { Inject, Injectable } from '@nestjs/common';
import type {
  NewsRights,
  ReviewState,
  TranslationCheckOverride,
  TranslationCheckResult,
  TranslationDesk,
  TranslationDeskVersion,
  TranslationField,
  TranslationMemoryEntry,
  TranslationQueue,
  TranslationQueueItem,
  TranslationTexts,
} from '@fmip/contracts';
import { checkTranslation, unresolvedFailures } from '@fmip/contracts/translation-checks';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import { glossaryFor, glossaryHits, namesToCarry, type LinkedName } from './translation-names';

/** How many of each bucket the desk's queue shows at most (T-1013). */
const TRANSLATION_QUEUE_LIMIT = 50;
/** How far back "to translate" looks, in days: the news a reader still sees. */
const TRANSLATION_QUEUE_DAYS = 7;
/** How many memory entries per field the desk shows at most, newest first (T-1014). */
const TRANSLATION_MEMORY_LIMIT = 5;

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
  | { kind: 'same_person' }
  /** Automatic checks fail and the reviewer gave no reason for passing them (T-1012). */
  | { kind: 'checks_fail'; failures: TranslationCheckResult[] }
  /** A reason was given for a check that does not fail: there is nothing to pass. */
  | { kind: 'not_failing'; override: TranslationCheckOverride };

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

  /**
   * The automatic checks on a translation (T-1012): the publisher's newest
   * version against the given words, with the names the translation must
   * carry. Read-only, and recomputed every time it is asked.
   */
  async checks(
    client: Pool | PoolClient,
    articleId: string,
    language: string,
    target: TranslationTexts,
  ): Promise<TranslationCheckResult[]> {
    const source = await client.query<{
      language: string;
      headline: string;
      summary: string | null;
      byline: string | null;
    }>(
      `SELECT language, headline, summary, byline FROM article_version
        WHERE article_id = $1 AND origin = 'publisher'
        ORDER BY created_at DESC, version_number DESC LIMIT 1`,
      [articleId],
    );
    const original = source.rows[0];
    if (original === undefined) return [];
    const linked = await client.query<{
      entity_type: LinkedName['entityType'];
      entity_id: string;
      names: string[];
      localised: string | null;
    }>(
      `SELECT ae.entity_type, ae.entity_id,
              array_remove(ARRAY[t.name, c.name, p.full_name, p.known_as], NULL)
                || ARRAY(SELECT ea.alias FROM entity_alias ea
                          WHERE ea.entity_type = ae.entity_type AND ea.entity_id = ae.entity_id
                            AND ea.kind IN ('name', 'alias')
                            AND (ea.language IS NULL OR ea.language = $2)) AS names,
              coalesce(localised_name(ae.entity_type, ae.entity_id, $3),
                       localised_name(ae.entity_type, ae.entity_id, split_part($3, '-', 1))) AS localised
         FROM article_entity ae
         LEFT JOIN team t ON ae.entity_type = 'team' AND t.id = ae.entity_id
         LEFT JOIN competition c ON ae.entity_type = 'competition' AND c.id = ae.entity_id
         LEFT JOIN person p ON ae.entity_type = 'person' AND p.id = ae.entity_id
        WHERE ae.article_id = $1 AND ae.entity_type IN ('team', 'competition', 'person')`,
      [articleId, original.language, language],
    );
    return checkTranslation(
      { headline: original.headline, summary: original.summary, byline: original.byline },
      target,
      {
        sourceLanguage: original.language,
        targetLanguage: language,
        names: namesToCarry(
          linked.rows.map((row) => ({
            entityType: row.entity_type,
            entityId: row.entity_id,
            sourceNames: row.names,
            localised: row.localised,
          })),
          glossaryFor(language),
        ),
      },
    );
  }

  async review(
    articleId: string,
    language: string,
    actorId: string,
    overrides: TranslationCheckOverride[] = [],
  ): Promise<ReviewOutcome> {
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
      // The checks, on the version the reviewer read. A failure passes only
      // with a reason, and a reason is given only for a failure (D-131).
      const results = await this.checks(client, articleId, language, {
        headline: current.headline,
        summary: current.summary,
        byline: current.byline,
      });
      const failures = unresolvedFailures(results, overrides);
      if (failures.length > 0) {
        await client.query('ROLLBACK');
        return { kind: 'checks_fail', failures };
      }
      for (const override of overrides) {
        const failed = results.find(
          (result) =>
            result.check === override.check &&
            result.field === override.field &&
            result.outcome === 'fail',
        );
        if (failed === undefined) {
          await client.query('ROLLBACK');
          return { kind: 'not_failing', override };
        }
        await client.query(
          `INSERT INTO translation_check_override
             (article_id, language, version_number, check_name, field, reason, reviewer_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            articleId,
            language,
            current.version_number,
            override.check,
            override.field,
            override.reason,
            actorId,
          ],
        );
        await record(client, {
          actorId,
          action: 'translation.check_override',
          targetId: articleId,
          reason: override.reason,
          previous: {
            language,
            version_number: current.version_number,
            check: override.check,
            field: override.field,
            outcome: 'fail',
            detail: failed.detail,
          },
          next: {
            language,
            version_number: current.version_number,
            check: override.check,
            field: override.field,
            outcome: 'passed_with_reason',
          },
        });
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

  /**
   * The desk's queue for one language (T-1013): promoted originals of the
   * last days with no translation into it, and every article whose newest
   * translation into it awaits review or is reviewed. Three bounded reads.
   */
  async queue(language: string): Promise<TranslationQueue> {
    const item = `
      SELECT a.id AS article_id, a.story_id, s.name AS source_name, s.language AS source_language,
             s.rights, src.headline, first.published_at,
             t.version_number, t.review_state, t.created_at AS updated_at,
             w.id AS written_id, w.username AS written_username,
             r.id AS reviewed_id, r.username AS reviewed_username
        FROM article a
        JOIN news_source s ON s.id = a.source_id AND s.dropped_at IS NULL
        CROSS JOIN LATERAL (
          SELECT headline FROM article_version v
           WHERE v.article_id = a.id AND v.origin = 'publisher'
           ORDER BY v.created_at DESC, v.version_number DESC LIMIT 1) src
        CROSS JOIN LATERAL (
          SELECT min(published_at) AS published_at FROM article_version v
           WHERE v.article_id = a.id) first
        LEFT JOIN LATERAL (
          SELECT version_number, review_state, created_at, written_by, reviewed_by
            FROM article_version v
           WHERE v.article_id = a.id AND v.language = $1 AND v.origin = 'translation'
           ORDER BY v.version_number DESC LIMIT 1) t ON true
        LEFT JOIN user_account w ON w.id = t.written_by
        LEFT JOIN user_account r ON r.id = t.reviewed_by`;
    const [toTranslate, awaiting, reviewed, now] = await Promise.all([
      this.pool.query<QueueRow>(
        `${item}
          JOIN story st ON st.promoted_article_id = a.id
         WHERE t.version_number IS NULL
           AND a.fetched_at > now() - make_interval(days => $2)
           AND NOT EXISTS (SELECT 1 FROM article_version p
                            WHERE p.article_id = a.id AND p.language = $1 AND p.origin = 'publisher')
         ORDER BY first.published_at DESC LIMIT $3`,
        [language, TRANSLATION_QUEUE_DAYS, TRANSLATION_QUEUE_LIMIT],
      ),
      this.pool.query<QueueRow>(
        `${item} WHERE t.review_state = 'translated' ORDER BY t.created_at ASC LIMIT $2`,
        [language, TRANSLATION_QUEUE_LIMIT],
      ),
      this.pool.query<QueueRow>(
        `${item} WHERE t.review_state = 'reviewed' ORDER BY t.created_at DESC LIMIT $2`,
        [language, TRANSLATION_QUEUE_LIMIT],
      ),
      this.pool.query<{ now: Date }>(`SELECT now() AS now`),
    ]);
    return {
      language,
      to_translate: toTranslate.rows.map(queueItem),
      awaiting_review: awaiting.rows.map(queueItem),
      reviewed: reviewed.rows.map(queueItem),
      generated_at: now.rows[0]!.now.toISOString(),
    };
  }

  /**
   * One article at the desk (T-1013): the publisher's newest words, the
   * newest translation into `language`, its checks and the glossary terms
   * the source uses. Null when there is no such article.
   */
  async desk(
    articleId: string,
    language: string,
    viewerId: string,
  ): Promise<TranslationDesk | null> {
    const source = await this.pool.query<{
      story_id: string;
      name: string;
      rights: NewsRights;
      url: string;
      language: string;
      version_number: number;
      headline: string;
      summary: string | null;
      byline: string | null;
      created_at: Date;
    }>(
      `SELECT a.story_id, s.name, s.rights, a.url, v.language, v.version_number,
              v.headline, v.summary, v.byline, v.created_at
         FROM article a
         JOIN news_source s ON s.id = a.source_id AND s.dropped_at IS NULL
         JOIN LATERAL (
           SELECT * FROM article_version v
            WHERE v.article_id = a.id AND v.origin = 'publisher'
            ORDER BY v.created_at DESC, v.version_number DESC LIMIT 1) v ON true
        WHERE a.id = $1`,
      [articleId],
    );
    const original = source.rows[0];
    if (original === undefined) return null;
    const newest = await this.pool.query<{
      version_number: number;
      review_state: ReviewState;
      headline: string;
      summary: string | null;
      byline: string | null;
      created_at: Date;
      written_id: string;
      written_username: string;
      reviewed_id: string | null;
      reviewed_username: string | null;
    }>(
      `SELECT v.version_number, v.review_state, v.headline, v.summary, v.byline, v.created_at,
              w.id AS written_id, w.username AS written_username,
              r.id AS reviewed_id, r.username AS reviewed_username
         FROM article_version v
         JOIN user_account w ON w.id = v.written_by
         LEFT JOIN user_account r ON r.id = v.reviewed_by
        WHERE v.article_id = $1 AND v.language = $2 AND v.origin = 'translation'
        ORDER BY v.version_number DESC LIMIT 1`,
      [articleId, language],
    );
    const current = newest.rows[0];
    const translation: TranslationDeskVersion | null =
      current === undefined
        ? null
        : {
            version_number: current.version_number,
            review_state: current.review_state,
            written_by: { id: current.written_id, username: current.written_username },
            reviewed_by:
              current.reviewed_id === null
                ? null
                : { id: current.reviewed_id, username: current.reviewed_username ?? '' },
            updated_at: current.created_at.toISOString(),
            headline: current.headline,
            summary: current.summary,
            byline: current.byline,
          };
    const checks =
      current === undefined
        ? []
        : await this.checks(this.pool, articleId, language, {
            headline: current.headline,
            summary: current.summary,
            byline: current.byline,
          });
    const fields: TranslationField[] = ['headline'];
    if (original.rights !== 'headline') {
      if (original.summary !== null) fields.push('summary');
      if (original.byline !== null) fields.push('byline');
    }
    return {
      article_id: articleId,
      story_id: original.story_id,
      language,
      source: {
        name: original.name,
        language: original.language,
        rights: original.rights,
        url: original.url,
        version_number: original.version_number,
        headline: original.headline,
        summary: original.summary,
        byline: original.byline,
        updated_at: original.created_at.toISOString(),
      },
      fields,
      translation,
      checks,
      glossary: glossaryHits(
        [original.headline, original.summary ?? '', original.byline ?? ''],
        glossaryFor(language),
      ),
      viewer_is_author: current !== undefined && current.written_id === viewerId,
      memory: await this.memory(articleId, language, original),
    };
  }

  /**
   * Translation memory (T-1014, D-130): for each field of the source, the
   * reviewed translations into `language` of another article whose publisher
   * version carries exactly the same string in the same field. Exact matches
   * only; each names who wrote and who reviewed it, and carries the newest
   * later version whose words differ as its correction. Read-only: nothing
   * here fills a field.
   */
  async memory(
    articleId: string,
    language: string,
    source: Record<TranslationField, string | null>,
  ): Promise<TranslationMemoryEntry[]> {
    const entries: TranslationMemoryEntry[] = [];
    for (const field of MEMORY_FIELDS) {
      const text = source[field];
      if (text === null || text.trim() === '') continue;
      // `field` is one of three fixed column names, never input.
      const { rows } = await this.pool.query<MemoryRow>(
        `SELECT r.article_id, r.version_number, r.${field} AS text, r.created_at,
                w.id AS written_id, w.username AS written_username,
                rv.id AS reviewed_id, rv.username AS reviewed_username,
                c.version_number AS c_version, c.${field} AS c_text, c.review_state AS c_state,
                c.created_at AS c_at, cw.id AS c_written_id, cw.username AS c_written_username
           FROM article_version r
           JOIN article a ON a.id = r.article_id
           JOIN news_source s ON s.id = a.source_id AND s.dropped_at IS NULL
           JOIN user_account w ON w.id = r.written_by
           JOIN user_account rv ON rv.id = r.reviewed_by
           LEFT JOIN LATERAL (
             SELECT * FROM article_version c
              WHERE c.article_id = r.article_id AND c.language = r.language
                AND c.origin = 'translation' AND c.version_number > r.version_number
                AND c.${field} IS DISTINCT FROM r.${field}
              ORDER BY c.version_number DESC LIMIT 1) c ON true
           LEFT JOIN user_account cw ON cw.id = c.written_by
          WHERE r.language = $1 AND r.origin = 'translation' AND r.review_state = 'reviewed'
            AND r.article_id <> $2 AND r.${field} IS NOT NULL
            AND EXISTS (SELECT 1 FROM article_version p
                         WHERE p.article_id = r.article_id AND p.origin = 'publisher'
                           AND p.${field} = $3)
          ORDER BY r.created_at DESC, r.article_id, r.version_number DESC
          LIMIT $4`,
        [language, articleId, text, TRANSLATION_MEMORY_LIMIT],
      );
      for (const row of rows) {
        entries.push({
          field,
          source: text,
          text: row.text,
          article_id: row.article_id,
          version_number: row.version_number,
          written_by: { id: row.written_id, username: row.written_username },
          reviewed_by: { id: row.reviewed_id, username: row.reviewed_username },
          reviewed_at: row.created_at.toISOString(),
          correction:
            row.c_version === null || row.c_state === null || row.c_at === null
              ? null
              : {
                  version_number: row.c_version,
                  text: row.c_text,
                  review_state: row.c_state,
                  written_by: {
                    id: row.c_written_id ?? '',
                    username: row.c_written_username ?? '',
                  },
                  updated_at: row.c_at.toISOString(),
                },
        });
      }
    }
    return entries;
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

interface QueueRow {
  article_id: string;
  story_id: string;
  source_name: string;
  source_language: string;
  rights: NewsRights;
  headline: string;
  published_at: Date;
  version_number: number | null;
  review_state: ReviewState | null;
  updated_at: Date | null;
  written_id: string | null;
  written_username: string | null;
  reviewed_id: string | null;
  reviewed_username: string | null;
}

function queueItem(row: QueueRow): TranslationQueueItem {
  return {
    article_id: row.article_id,
    story_id: row.story_id,
    source_name: row.source_name,
    source_language: row.source_language,
    rights: row.rights,
    headline: row.headline,
    published_at: row.published_at.toISOString(),
    translation:
      row.version_number === null || row.review_state === null || row.written_id === null
        ? null
        : {
            version_number: row.version_number,
            review_state: row.review_state,
            written_by: { id: row.written_id, username: row.written_username ?? '' },
            reviewed_by:
              row.reviewed_id === null
                ? null
                : { id: row.reviewed_id, username: row.reviewed_username ?? '' },
            updated_at: row.updated_at!.toISOString(),
          },
  };
}

const MEMORY_FIELDS = [
  'headline',
  'summary',
  'byline',
] as const satisfies readonly TranslationField[];

interface MemoryRow {
  article_id: string;
  version_number: number;
  text: string;
  created_at: Date;
  written_id: string;
  written_username: string;
  reviewed_id: string;
  reviewed_username: string;
  c_version: number | null;
  c_text: string | null;
  c_state: ReviewState | null;
  c_at: Date | null;
  c_written_id: string | null;
  c_written_username: string | null;
}
