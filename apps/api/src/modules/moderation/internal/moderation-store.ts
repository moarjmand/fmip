/**
 * The SQL for moderation (T-211). All of it, and nothing else.
 *
 * The rules are not here. A decision's immutability, a sanction's end, the
 * refusal of a friend request from a restricted member: all of that is the
 * schema's (T-210). This file writes what the service decided and reads back
 * what the tables say, and never re-implements a refusal — two copies of a
 * safety rule are one copy and one decoration.
 */

import type { Pool } from 'pg';

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

  /** One sanction with the member it is on, for the appeal check. */
  async sanction(id: string): Promise<{ id: string; user_id: string } | null> {
    const { rows } = await this.pool.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM sanction WHERE id = $1`,
      [id],
    );
    return rows[0] ?? null;
  }

  async appeal(sanctionId: string, authorId: string, body: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO appeal_note (sanction_id, author_id, body) VALUES ($1, $2, $3)`,
      [sanctionId, authorId, body],
    );
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
