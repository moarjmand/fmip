import { Inject, Injectable } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/**
 * The SQL for community-written analysis (T-260, T-261). All of it, and nothing
 * else.
 *
 * The rules are not here. Who may write one, when a submission is too late, and
 * which decisions are possible are all the schema's — `PL014`, `PL002` and the
 * primary key on `community_analysis_review`. This file writes what the service
 * decided and reads back what the tables say, and re-implements none of it.
 */

export interface ContentRow {
  predicted_outcome: string;
  predicted_home: number | null;
  predicted_away: number | null;
  confidence: number;
  reasoning: string;
  lineup_impact: string | null;
  key_players: string | null;
  form_and_context: string | null;
}

export interface SubmissionRow extends ContentRow {
  id: string;
  attempt: number;
  submitted_at: Date;
  decision: string | null;
  reviewer: string | null;
  review_reason: string | null;
  reviewed_at: Date | null;
}

export interface VersionRow extends ContentRow {
  id: string;
  version_number: number;
  published_at: Date;
}

export interface AnalysisRow {
  id: string;
  fixture_id: string;
  username: string;
  display_name: string;
  rating: string | null;
  approved: boolean;
  state: string;
}

/** The columns every content-carrying table shares, in one place. */
const CONTENT = `predicted_outcome, predicted_home, predicted_away, confidence,
                 reasoning, lineup_impact, key_players, form_and_context`;

@Injectable()
export class PostgresAnalysisStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Start one, or find the one this analyst already has for this match.
   *
   * `ON CONFLICT DO UPDATE` rather than a lookup first: two tabs would both pass
   * a lookup and only one should write, and the unique constraint on
   * (fixture, author) is what decides. The approval trigger still runs, so an
   * unapproved member is refused here and not in a check above.
   */
  async open(fixtureId: string, authorId: string): Promise<string> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO community_analysis (fixture_id, author_id)
       VALUES ($1, $2)
       ON CONFLICT (fixture_id, author_id) DO UPDATE SET fixture_id = EXCLUDED.fixture_id
       RETURNING id`,
      [fixtureId, authorId],
    );
    return rows[0]?.id ?? '';
  }

  /** The analyst's own analysis of one fixture, or null. */
  async mine(fixtureId: string, authorId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM community_analysis WHERE fixture_id = $1 AND author_id = $2`,
      [fixtureId, authorId],
    );
    return rows[0]?.id ?? null;
  }

  /** Whose it is, so a surface can refuse somebody else's without a second query. */
  async authorOf(analysisId: string): Promise<{ authorId: string; fixtureId: string } | null> {
    const { rows } = await this.pool.query<{ author_id: string; fixture_id: string }>(
      `SELECT author_id, fixture_id FROM community_analysis WHERE id = $1`,
      [analysisId],
    );
    const row = rows[0];
    return row === undefined ? null : { authorId: row.author_id, fixtureId: row.fixture_id };
  }

  async saveDraft(analysisId: string, content: ContentRow): Promise<void> {
    await this.pool.query(
      `INSERT INTO community_analysis_draft (analysis_id, ${CONTENT})
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (analysis_id) DO UPDATE
          SET predicted_outcome = EXCLUDED.predicted_outcome,
              predicted_home = EXCLUDED.predicted_home,
              predicted_away = EXCLUDED.predicted_away,
              confidence = EXCLUDED.confidence,
              reasoning = EXCLUDED.reasoning,
              lineup_impact = EXCLUDED.lineup_impact,
              key_players = EXCLUDED.key_players,
              form_and_context = EXCLUDED.form_and_context`,
      [
        analysisId,
        content.predicted_outcome,
        content.predicted_home,
        content.predicted_away,
        content.confidence,
        content.reasoning,
        content.lineup_impact,
        content.key_players,
        content.form_and_context,
      ],
    );
  }

  async draft(analysisId: string): Promise<ContentRow | null> {
    const { rows } = await this.pool.query<ContentRow>(
      `SELECT ${CONTENT} FROM community_analysis_draft WHERE analysis_id = $1`,
      [analysisId],
    );
    return rows[0] ?? null;
  }

  /**
   * Submit the draft as it stands, as the next attempt.
   *
   * The attempt number is computed inside the transaction, so two submissions
   * racing cannot both claim the same one — the unique constraint would refuse
   * the second anyway, and computing it outside would turn a clean refusal into
   * a lost submission.
   */
  async submit(analysisId: string): Promise<string | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO community_analysis_submission (analysis_id, attempt, ${CONTENT})
         SELECT d.analysis_id,
                coalesce((SELECT max(attempt) FROM community_analysis_submission
                           WHERE analysis_id = d.analysis_id), 0) + 1,
                d.predicted_outcome, d.predicted_home, d.predicted_away, d.confidence,
                d.reasoning, d.lineup_impact, d.key_players, d.form_and_context
           FROM community_analysis_draft d
          WHERE d.analysis_id = $1
         RETURNING id`,
        [analysisId],
      );
      await client.query('COMMIT');
      // No rows means there was no draft to submit, which the service turns
      // into a sentence rather than an error.
      return rows[0]?.id ?? null;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Every attempt on one analysis, oldest first, with its decision if it has one. */
  async submissions(analysisId: string): Promise<SubmissionRow[]> {
    const { rows } = await this.pool.query<SubmissionRow>(
      `SELECT s.id, s.attempt, s.submitted_at,
              s.predicted_outcome, s.predicted_home, s.predicted_away, s.confidence,
              s.reasoning, s.lineup_impact, s.key_players, s.form_and_context,
              r.decision, reviewer.username AS reviewer, r.reason AS review_reason,
              r.created_at AS reviewed_at
         FROM community_analysis_submission s
         LEFT JOIN community_analysis_review r ON r.submission_id = s.id
         LEFT JOIN user_account reviewer ON reviewer.id = r.reviewer_id
        WHERE s.analysis_id = $1
        ORDER BY s.attempt`,
      [analysisId],
    );
    return rows;
  }

  async versions(analysisId: string): Promise<VersionRow[]> {
    const { rows } = await this.pool.query<VersionRow>(
      `SELECT id, version_number, published_at, ${CONTENT}
         FROM community_analysis_version
        WHERE analysis_id = $1
        ORDER BY version_number DESC`,
      [analysisId],
    );
    return rows;
  }

  async state(analysisId: string): Promise<string> {
    const { rows } = await this.pool.query<{ s: string }>(
      `SELECT community_analysis_state($1) AS s`,
      [analysisId],
    );
    return rows[0]?.s ?? 'draft';
  }

  /** What a reviewer is looking at: the submission, and who wrote it. */
  async submission(
    submissionId: string,
  ): Promise<
    (SubmissionRow & { analysis_id: string; author: string; author_rating: string | null }) | null
  > {
    const { rows } = await this.pool.query<
      SubmissionRow & { analysis_id: string; author: string; author_rating: string | null }
    >(
      `SELECT s.id, s.analysis_id, s.attempt, s.submitted_at,
              s.predicted_outcome, s.predicted_home, s.predicted_away, s.confidence,
              s.reasoning, s.lineup_impact, s.key_players, s.form_and_context,
              r.decision, reviewer.username AS reviewer, r.reason AS review_reason,
              r.created_at AS reviewed_at,
              author.username AS author,
              rating.rating AS author_rating
         FROM community_analysis_submission s
         JOIN community_analysis a ON a.id = s.analysis_id
         JOIN user_account author ON author.id = a.author_id
         LEFT JOIN community_analysis_review r ON r.submission_id = s.id
         LEFT JOIN user_account reviewer ON reviewer.id = r.reviewer_id
         LEFT JOIN LATERAL (
           SELECT rs.rating FROM rating_snapshot rs
            WHERE rs.user_id = a.author_id
            ORDER BY rs.computed_at DESC, rs.id DESC LIMIT 1
         ) rating ON true
        WHERE s.id = $1`,
      [submissionId],
    );
    return rows[0] ?? null;
  }

  /**
   * Record a decision, and publish in the same transaction when it is an
   * approval.
   *
   * One act, because that is what it is: a reviewer approving an analysis is
   * saying it may be read, and a decision that recorded an approval and then
   * failed to publish would leave an analyst told yes and a public told nothing.
   * The audit row goes in the same transaction for the same reason (rule 10,
   * D-046).
   */
  async decide(
    submissionId: string,
    analysisId: string,
    reviewerId: string,
    decision: 'approved' | 'changes_requested' | 'rejected',
    reason: string,
  ): Promise<{ versionNumber: number | null }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO community_analysis_review (submission_id, reviewer_id, decision, reason)
         VALUES ($1, $2, $3, $4)`,
        [submissionId, reviewerId, decision, reason],
      );

      let versionNumber: number | null = null;
      if (decision === 'approved') {
        const { rows } = await client.query<{ version_number: number }>(
          `INSERT INTO community_analysis_version
             (analysis_id, submission_id, version_number, ${CONTENT})
           SELECT s.analysis_id, s.id,
                  coalesce((SELECT max(version_number) FROM community_analysis_version
                             WHERE analysis_id = s.analysis_id), 0) + 1,
                  s.predicted_outcome, s.predicted_home, s.predicted_away, s.confidence,
                  s.reasoning, s.lineup_impact, s.key_players, s.form_and_context
             FROM community_analysis_submission s
            WHERE s.id = $1
           RETURNING version_number`,
          [submissionId],
        );
        versionNumber = rows[0]?.version_number ?? null;
      }

      await record(client, {
        actorId: reviewerId,
        action: `analysis.${decision === 'changes_requested' ? 'changes' : decision}`,
        targetId: analysisId,
        reason,
        next: { decision, submission_id: submissionId, version_number: versionNumber },
      });
      await client.query('COMMIT');
      return { versionNumber };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Submissions nobody has decided about yet, oldest first: the longest wait is first. */
  async queue(
    limit: number,
  ): Promise<
    (SubmissionRow & { analysis_id: string; author: string; author_rating: string | null })[]
  > {
    const { rows } = await this.pool.query<
      SubmissionRow & { analysis_id: string; author: string; author_rating: string | null }
    >(
      `SELECT s.id, s.analysis_id, s.attempt, s.submitted_at,
              s.predicted_outcome, s.predicted_home, s.predicted_away, s.confidence,
              s.reasoning, s.lineup_impact, s.key_players, s.form_and_context,
              NULL::text AS decision, NULL::text AS reviewer, NULL::text AS review_reason,
              NULL::timestamptz AS reviewed_at,
              author.username AS author,
              rating.rating AS author_rating
         FROM community_analysis_submission s
         JOIN community_analysis a ON a.id = s.analysis_id
         JOIN user_account author ON author.id = a.author_id
         LEFT JOIN community_analysis_review r ON r.submission_id = s.id
         LEFT JOIN LATERAL (
           SELECT rs.rating FROM rating_snapshot rs
            WHERE rs.user_id = a.author_id
            ORDER BY rs.computed_at DESC, rs.id DESC LIMIT 1
         ) rating ON true
        WHERE r.submission_id IS NULL
        ORDER BY s.submitted_at
        LIMIT $1`,
      [limit],
    );
    return rows;
  }

  /** Everything published on one fixture, with each author's standing as it is now. */
  async published(fixtureId: string): Promise<(AnalysisRow & { versions: VersionRow[] })[]> {
    const { rows } = await this.pool.query<AnalysisRow>(
      `SELECT a.id,
              a.fixture_id,
              author.username,
              author.display_name,
              rating.rating,
              member_may_contribute(a.author_id) AS approved,
              community_analysis_state(a.id) AS state
         FROM community_analysis a
         JOIN user_account author ON author.id = a.author_id
         LEFT JOIN LATERAL (
           SELECT rs.rating FROM rating_snapshot rs
            WHERE rs.user_id = a.author_id
            ORDER BY rs.computed_at DESC, rs.id DESC LIMIT 1
         ) rating ON true
        WHERE a.fixture_id = $1
          AND EXISTS (SELECT 1 FROM community_analysis_version v WHERE v.analysis_id = a.id)
        ORDER BY a.created_at DESC`,
      [fixtureId],
    );
    return Promise.all(
      rows.map(async (row) => ({ ...row, versions: await this.versions(row.id) })),
    );
  }
}

interface AuditEntry {
  actorId: string;
  action: string;
  targetId: string;
  reason: string;
  next: Record<string, unknown>;
}

/**
 * `target_type` is `community_analysis`: the thing that changed is an analysis,
 * and "who approved this analysis" is the only question the row is ever asked.
 */
async function record(client: PoolClient, entry: AuditEntry): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
     VALUES ($1, $2, 'community_analysis', $3, $4, NULL, $5::jsonb)`,
    [entry.actorId, entry.action, entry.targetId, entry.reason, JSON.stringify(entry.next)],
  );
}
