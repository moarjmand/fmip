import { Inject, Injectable } from '@nestjs/common';
import type {
  TranslationCheckOverride,
  TranslationCheckResult,
  TranslationTexts,
} from '@fmip/contracts';
import { checkTranslation, unresolvedFailures } from '@fmip/contracts/translation-checks';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import { glossaryFor, namesToCarry, type LinkedName } from './translation-names';

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
