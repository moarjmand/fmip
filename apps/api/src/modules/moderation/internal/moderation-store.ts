/**
 * The SQL for moderation (T-211). All of it, and nothing else.
 *
 * The rules are not here. A decision's immutability, a sanction's end, the
 * refusal of a friend request from a restricted member: all of that is the
 * schema's (T-210). This file writes what the service decided and reads back
 * what the tables say, and never re-implements a refusal — two copies of a
 * safety rule are one copy and one decoration.
 */

import type { Pool, PoolClient } from 'pg';
import { APPEALABLE_DECISION_OUTCOMES } from '@fmip/contracts';

export interface MemberRow {
  id: string;
  username: string;
}

export interface SanctionRow {
  id: string;
  username: string;
  scope: string;
  scope_id: string | null;
  starts_at: Date;
  ends_at: Date | null;
  permanent: boolean;
  active: boolean;
  lifted_at: Date | null;
  lifted_by: string | null;
  lift_reason: string | null;
  decision_id: string;
}

export interface OwnSanctionRow extends Omit<SanctionRow, 'lifted_by'> {
  reason: string;
  appealed_at: Date | null;
}

/** What writing an appeal came to. `unknown` and `not_yours` are both "not found" to the caller. */
export type AppealOutcome = 'appealed' | 'unknown' | 'not_yours' | 'already_appealed';

export interface OwnDecisionRow {
  id: string;
  outcome: string;
  reason: string;
  created_at: Date;
  appealed_at: Date | null;
}

export interface QueuedAppealRow {
  id: string;
  username: string;
  sanction_id: string | null;
  scope: string | null;
  active: boolean | null;
  decision_id: string;
  outcome: string;
  decision_reason: string;
  body: string;
  created_at: Date;
}

export interface ReportRow {
  id: string;
  subject_type: string;
  subject_id: string;
  reason: string;
  detail: string | null;
  created_at: Date;
  decision_id: string | null;
}

export class ModerationStore {
  constructor(private readonly pool: Pool) {}

  async memberByUsername(username: string): Promise<MemberRow | null> {
    const { rows } = await this.pool.query<MemberRow>(
      `SELECT id, username FROM user_account WHERE username = lower($1) AND status = 'active'`,
      [username],
    );
    return rows[0] ?? null;
  }

  /**
   * File a report. `false` when this reporter already has an open one about
   * this subject — the partial unique index of T-210 decides that, not a
   * lookup-then-insert that two taps could both pass.
   */
  async file(
    reporterId: string,
    subjectType: string,
    subjectId: string,
    reason: string,
    detail: string | null,
  ): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO report (reporter_id, subject_type, subject_id, reason, detail)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT DO NOTHING`,
      [reporterId, subjectType, subjectId, reason, detail],
    );
    return rowCount === 1;
  }

  /** The reports this member has filed, newest first. Never anybody else's. */
  async filedBy(reporterId: string): Promise<ReportRow[]> {
    const { rows } = await this.pool.query<ReportRow>(
      `SELECT id, subject_type, subject_id, reason, detail, created_at, decision_id
         FROM report
        WHERE reporter_id = $1
        ORDER BY created_at DESC
        LIMIT 100`,
      [reporterId],
    );
    return rows;
  }

  /**
   * Every sanction on a member, active or not, newest first.
   *
   * `active` is computed by the database rather than by comparing dates in
   * TypeScript, so that the answer a member is shown and the answer the
   * `friend_request` trigger acts on come from the same clock.
   */
  async sanctionsOn(userId: string): Promise<SanctionRow[]> {
    const { rows } = await this.pool.query<SanctionRow>(
      `SELECT s.id,
              u.username,
              s.scope,
              s.scope_id,
              s.starts_at,
              s.ends_at,
              s.permanent,
              (s.lifted_at IS NULL
                 AND s.starts_at <= now()
                 AND (s.ends_at IS NULL OR s.ends_at > now())) AS active,
              s.lifted_at,
              lifter.username AS lifted_by,
              s.lift_reason,
              s.decision_id
         FROM sanction s
         JOIN user_account u ON u.id = s.user_id
         LEFT JOIN user_account lifter ON lifter.id = s.lifted_by
        WHERE s.user_id = $1
        ORDER BY s.starts_at DESC`,
      [userId],
    );
    return rows;
  }

  /**
   * The sanctions on a member as they read them (T-1973): each with its
   * decision's written reason and when they appealed it.
   *
   * `appealed_at` is the member's own first note on it; the moderator's notes
   * that may sit beside it are not the member's appeal. Who lifted it is not
   * read at all: the member is told which and why, never who.
   */
  async ownSanctions(userId: string): Promise<OwnSanctionRow[]> {
    const { rows } = await this.pool.query<OwnSanctionRow>(
      `SELECT s.id,
              u.username,
              s.scope,
              s.scope_id,
              s.starts_at,
              s.ends_at,
              s.permanent,
              (s.lifted_at IS NULL
                 AND s.starts_at <= now()
                 AND (s.ends_at IS NULL OR s.ends_at > now())) AS active,
              s.lifted_at,
              s.lift_reason,
              s.decision_id,
              d.reason,
              (SELECT min(n.created_at)
                 FROM appeal_note n
                WHERE n.sanction_id = s.id AND n.author_id = s.user_id) AS appealed_at
         FROM sanction s
         JOIN user_account u ON u.id = s.user_id
         JOIN moderation_decision d ON d.id = s.decision_id
        WHERE s.user_id = $1
        ORDER BY s.starts_at DESC`,
      [userId],
    );
    return rows;
  }

  /**
   * The member's appeal of their own sanction, written once (T-1973; the
   * platform rules: "every decision can be appealed once, in writing").
   *
   * The sanction's row is locked for the check and the insert, so two taps
   * cannot both find no appeal and both write one. The lock is `FOR UPDATE`
   * on a read, which no trigger sees: the sanction itself is not changed.
   */
  async appealOnce(
    sanctionId: string,
    userId: string,
    body: string,
  ): Promise<AppealOutcome | 'not_appealable'> {
    return this.appealUnderLock(
      // A member appeals their own sanction. A moderator's note on somebody
      // else's is part of the queue (T-212), not of this route.
      `SELECT user_id = $2 AS mine, true AS appealable FROM sanction WHERE id = $1 FOR UPDATE`,
      'sanction_id',
      sanctionId,
      userId,
      body,
    );
  }

  /**
   * The member's appeal of a decision about them that carries no sanction --
   * a warning, content removed -- written once, the same way (T-1973). The
   * decision's row is the one locked: it is immutable, and `FOR UPDATE` on a
   * read changes nothing its trigger would refuse.
   */
  async appealDecisionOnce(
    decisionId: string,
    userId: string,
    body: string,
  ): Promise<AppealOutcome | 'not_appealable'> {
    return this.appealUnderLock(
      `SELECT (subject_type = 'member' AND subject_id = $2::text) AS mine,
              outcome = ANY($3::text[]) AS appealable
         FROM moderation_decision WHERE id = $1 FOR UPDATE`,
      'decision_id',
      decisionId,
      userId,
      body,
      [APPEALABLE_DECISION_OUTCOMES],
    );
  }

  /**
   * Lock the appealed row, check it is the member's and that they have not
   * appealed it, and write the note: one transaction, so two taps cannot both
   * find no appeal and both write one.
   */
  private async appealUnderLock(
    lockSql: string,
    column: 'sanction_id' | 'decision_id',
    id: string,
    userId: string,
    body: string,
    extra: unknown[] = [],
  ): Promise<AppealOutcome | 'not_appealable'> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ mine: boolean; appealable: boolean }>(lockSql, [
        id,
        userId,
        ...extra,
      ]);
      const found = rows[0];
      let outcome: AppealOutcome | 'not_appealable';
      if (found === undefined) {
        outcome = 'unknown';
      } else if (!found.mine) {
        outcome = 'not_yours';
      } else if (!found.appealable) {
        outcome = 'not_appealable';
      } else {
        const { rowCount } = await client.query(
          `SELECT 1 FROM appeal_note WHERE ${column} = $1 AND author_id = $2 LIMIT 1`,
          [id, userId],
        );
        if ((rowCount ?? 0) > 0) {
          outcome = 'already_appealed';
        } else {
          await client.query(
            `INSERT INTO appeal_note (${column}, author_id, body) VALUES ($1, $2, $3)`,
            [id, userId, body],
          );
          outcome = 'appealed';
        }
      }
      await client.query(outcome === 'appealed' ? 'COMMIT' : 'ROLLBACK');
      return outcome;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * The decisions about a member that carry no sanction and are shown to them
   * (T-1973): what, why, when, and when they appealed it. Never who decided.
   */
  async ownDecisions(userId: string): Promise<OwnDecisionRow[]> {
    const { rows } = await this.pool.query<OwnDecisionRow>(
      `SELECT d.id,
              d.outcome,
              d.reason,
              d.created_at,
              (SELECT min(n.created_at)
                 FROM appeal_note n
                WHERE n.decision_id = d.id AND n.author_id = $1) AS appealed_at
         FROM moderation_decision d
        WHERE d.subject_type = 'member'
          AND d.subject_id = $1::text
          AND d.outcome = ANY($2::text[])
        ORDER BY d.created_at DESC`,
      [userId, APPEALABLE_DECISION_OUTCOMES],
    );
    return rows;
  }

  /**
   * Members' own appeals of sanctions and decisions about them, newest first
   * (T-1973): for the moderators' queue, or one member's history. A note by
   * anybody but the member the decision is about is not their appeal, and a
   * group's closure has its own page.
   */
  async appeals(limit: number, memberId: string | null = null): Promise<QueuedAppealRow[]> {
    const { rows } = await this.pool.query<QueuedAppealRow>(
      `SELECT n.id,
              u.username,
              n.sanction_id,
              s.scope,
              CASE WHEN s.id IS NULL THEN NULL
                   ELSE (s.lifted_at IS NULL
                           AND s.starts_at <= now()
                           AND (s.ends_at IS NULL OR s.ends_at > now()))
              END AS active,
              d.id AS decision_id,
              d.outcome,
              d.reason AS decision_reason,
              n.body,
              n.created_at
         FROM appeal_note n
         JOIN user_account u ON u.id = n.author_id
         LEFT JOIN sanction s ON s.id = n.sanction_id
         JOIN moderation_decision d ON d.id = COALESCE(s.decision_id, n.decision_id)
        WHERE d.subject_type = 'member'
          AND d.subject_id = n.author_id::text
          AND ($2::uuid IS NULL OR n.author_id = $2::uuid)
        ORDER BY n.created_at DESC
        LIMIT $1`,
      [limit, memberId],
    );
    return rows;
  }

  async appealNotes(
    sanctionId: string,
  ): Promise<{ id: string; author: string; body: string; created_at: Date }[]> {
    const { rows } = await this.pool.query<{
      id: string;
      author: string;
      body: string;
      created_at: Date;
    }>(
      `SELECT n.id, u.username AS author, n.body, n.created_at
         FROM appeal_note n
         JOIN user_account u ON u.id = n.author_id
        WHERE n.sanction_id = $1
        ORDER BY n.created_at`,
      [sanctionId],
    );
    return rows;
  }
}

export interface QueueRow {
  report_id: string;
  reporter: string;
  subject_id: string;
  username: string;
  display_name: string;
  reason: string;
  detail: string | null;
  created_at: Date;
  active_sanctions: string;
}

export interface DecisionRow {
  id: string;
  moderator: string;
  subject_type: string;
  subject_id: string;
  outcome: string;
  reason: string;
  created_at: Date;
}

export interface AuditEntry {
  actorId: string;
  action: string;
  targetId: string;
  reason: string;
  next: unknown;
}

export interface DecideInput {
  moderatorId: string;
  subjectId: string;
  reportIds: string[];
  outcome: string;
  reason: string;
  sanction: { scope: string; endsAt: string | null; permanent: boolean } | null;
}

/**
 * The moderator's half of the store (T-212).
 *
 * `decide` is one transaction on purpose (D-046). A decision that is visible in
 * the product and absent from the audit log is the gap rule 10 exists to close,
 * and four statements outside a transaction leave it open on any error between
 * them — a sanction with no decision, a decision with no audit row, reports
 * closed by a judgement that was rolled back.
 */
export class ModerationQueueStore {
  constructor(private readonly pool: Pool) {}

  async queue(limit: number): Promise<{ rows: QueueRow[]; total: number }> {
    const { rows } = await this.pool.query<QueueRow>(
      `SELECT r.id AS report_id,
              reporter.username AS reporter,
              r.subject_id,
              subject.username,
              subject.display_name,
              r.reason,
              r.detail,
              r.created_at,
              (SELECT count(*) FROM sanction s
                WHERE s.user_id = subject.id
                  AND s.lifted_at IS NULL
                  AND s.starts_at <= now()
                  AND (s.ends_at IS NULL OR s.ends_at > now())) AS active_sanctions
         FROM report r
         JOIN user_account reporter ON reporter.id = r.reporter_id
         JOIN user_account subject ON subject.id = r.subject_id::uuid
        WHERE r.decision_id IS NULL AND r.subject_type = 'member'
        ORDER BY r.created_at
        LIMIT $1`,
      [limit],
    );
    const { rows: counted } = await this.pool.query<{ total: string }>(
      `SELECT count(*) AS total FROM report WHERE decision_id IS NULL`,
    );
    return { rows, total: Number(counted[0]?.total ?? '0') };
  }

  async decisionsAbout(subjectId: string): Promise<DecisionRow[]> {
    const { rows } = await this.pool.query<DecisionRow>(
      `SELECT d.id, u.username AS moderator, d.subject_type, d.subject_id, d.outcome, d.reason,
              d.created_at
         FROM moderation_decision d
         JOIN user_account u ON u.id = d.moderator_id
        WHERE d.subject_type = 'member' AND d.subject_id = $1
        ORDER BY d.created_at DESC`,
      [subjectId],
    );
    return rows;
  }

  async reportsAbout(subjectId: string): Promise<QueueRow[]> {
    const { rows } = await this.pool.query<QueueRow>(
      `SELECT r.id AS report_id, reporter.username AS reporter, r.subject_id,
              subject.username, subject.display_name, r.reason, r.detail, r.created_at,
              '0' AS active_sanctions
         FROM report r
         JOIN user_account reporter ON reporter.id = r.reporter_id
         JOIN user_account subject ON subject.id = r.subject_id::uuid
        WHERE r.subject_type = 'member' AND r.subject_id = $1
        ORDER BY r.created_at DESC
        LIMIT 100`,
      [subjectId],
    );
    return rows;
  }

  /** The decision, the reports it answers, any sanction, and the audit row — one transaction. */
  async decide(input: DecideInput): Promise<{ decisionId: string; answered: number }> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO moderation_decision
           (moderator_id, subject_type, subject_id, outcome, reason)
         VALUES ($1, 'member', $2, $3, $4) RETURNING id`,
        [input.moderatorId, input.subjectId, input.outcome, input.reason],
      );
      const decisionId = rows[0]?.id ?? '';

      // Only reports that are still open and are actually about this subject.
      // A moderator cannot close somebody else's queue item by naming its id.
      const { rowCount } = await client.query(
        `UPDATE report SET decision_id = $1
          WHERE id = ANY($2::uuid[]) AND decision_id IS NULL AND subject_id = $3`,
        [decisionId, input.reportIds, input.subjectId],
      );

      if (input.sanction !== null) {
        await client.query(
          `INSERT INTO sanction (user_id, decision_id, scope, ends_at, permanent)
           VALUES ($1, $2, $3, $4, $5)`,
          [
            input.subjectId,
            decisionId,
            input.sanction.scope,
            input.sanction.endsAt,
            input.sanction.permanent,
          ],
        );
      }

      await this.record(client, {
        actorId: input.moderatorId,
        action: 'moderation.decide',
        targetId: input.subjectId,
        reason: input.reason,
        next: {
          decision_id: decisionId,
          outcome: input.outcome,
          reports_answered: rowCount ?? 0,
          sanction: input.sanction,
        },
      });

      await client.query('COMMIT');
      return { decisionId, answered: rowCount ?? 0 };
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** `false` when there was no sanction of that id still in force. */
  async lift(moderatorId: string, sanctionId: string, reason: string): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ user_id: string }>(
        `UPDATE sanction
            SET lifted_at = now(), lifted_by = $1, lift_reason = $2
          WHERE id = $3 AND lifted_at IS NULL
        RETURNING user_id`,
        [moderatorId, reason, sanctionId],
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return false;
      }
      await this.record(client, {
        actorId: moderatorId,
        action: 'moderation.lift',
        targetId: rows[0]?.user_id ?? '',
        reason,
        next: { sanction_id: sanctionId, lifted: true },
      });
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  private async record(client: PoolClient, entry: AuditEntry): Promise<void> {
    await client.query(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
       VALUES ($1, $2, 'user_account', $3, $4, NULL, $5::jsonb)`,
      [entry.actorId, entry.action, entry.targetId, entry.reason, JSON.stringify(entry.next)],
    );
  }
}
