import type { Pool, PoolClient } from 'pg';

export interface ModeratedGroupRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: string;
  member_count: string;
  owner: string | null;
  closed_at: Date | null;
  closed_reason: string | null;
  closed_decision_id: string | null;
}

export interface GroupReportRow {
  report_id: string;
  reporter: string;
  group_id: string;
  slug: string;
  name: string;
  visibility: string;
  closed_at: Date | null;
  closed_reason: string | null;
  closed_decision_id: string | null;
  reason: string;
  detail: string | null;
  created_at: Date;
  decision_id: string | null;
}

export interface GroupDecisionRow {
  id: string;
  moderator: string;
  subject_id: string;
  outcome: string;
  reason: string;
  created_at: Date;
}

export interface GroupAppealRow {
  id: string;
  decision_id: string;
  author: string;
  body: string;
  created_at: Date;
}

export type GroupAction =
  | { kind: 'close' }
  | { kind: 'reopen' }
  | { kind: 'remove'; messageIds: string[]; description: boolean }
  | { kind: 'dismiss' };

export interface GroupDecisionInput {
  moderatorId: string;
  groupId: string;
  reason: string;
  reportIds: string[];
  action: GroupAction;
}

const OUTCOME: Record<GroupAction['kind'], string> = {
  close: 'group_closed',
  reopen: 'group_reopened',
  remove: 'content_removed',
  dismiss: 'no_action',
};

const AUDIT_ACTION: Record<GroupAction['kind'], string> = {
  close: 'moderation.group_close',
  reopen: 'moderation.group_reopen',
  remove: 'moderation.group_content',
  dismiss: 'moderation.group_dismiss',
};

const GROUP_COLUMNS = `g.id, g.slug, g.name, g.description, g.visibility,
       (SELECT count(*) FROM group_member m WHERE m.group_id = g.id) AS member_count,
       (SELECT u.username FROM group_member m JOIN user_account u ON u.id = m.user_id
         WHERE m.group_id = g.id AND m.role = 'owner') AS owner,
       g.closed_at, g.closed_reason, g.closed_decision_id`;

const REPORT_COLUMNS = `r.id AS report_id, reporter.username AS reporter, g.id AS group_id,
       g.slug, g.name, g.visibility, g.closed_at, g.closed_reason, g.closed_decision_id,
       r.reason, r.detail, r.created_at, r.decision_id`;

/**
 * Every statement about administrators and groups (T-1025, D-135).
 *
 * A group is read from the shared schema here, as the card store reads
 * fixtures: the moderation boundary needs one row per group and the groups
 * boundary's service answers a member's questions, not a moderator's. Each
 * decision -- the `moderation_decision`, what it changes, the reports it
 * answers and the `audit_log` row with the previous state -- is one
 * transaction (D-046, rule 10).
 */
export class GroupModerationStore {
  constructor(private readonly pool: Pool) {}

  async bySlug(slug: string): Promise<ModeratedGroupRow | null> {
    const { rows } = await this.pool.query<ModeratedGroupRow>(
      `SELECT ${GROUP_COLUMNS} FROM user_group g WHERE g.slug = lower($1)`,
      [slug],
    );
    return rows[0] ?? null;
  }

  /**
   * A group a member may report: one they can find, or one they are in or
   * invited to. An invite-only group nobody told them about is `null`, the
   * same answer the groups boundary gives a stranger.
   */
  async reportable(slug: string, reporterId: string): Promise<{ id: string } | null> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT g.id FROM user_group g
        WHERE g.slug = lower($1)
          AND (g.visibility <> 'invite_only'
               OR EXISTS (SELECT 1 FROM group_member m WHERE m.group_id = g.id AND m.user_id = $2)
               OR EXISTS (SELECT 1 FROM group_invite i WHERE i.group_id = g.id AND i.invitee_id = $2))`,
      [slug, reporterId],
    );
    return rows[0] ?? null;
  }

  async openReports(limit: number): Promise<GroupReportRow[]> {
    const { rows } = await this.pool.query<GroupReportRow>(
      `SELECT ${REPORT_COLUMNS}
         FROM report r
         JOIN user_account reporter ON reporter.id = r.reporter_id
         JOIN user_group g ON g.id::text = r.subject_id
        WHERE r.decision_id IS NULL AND r.subject_type = 'group'
        ORDER BY r.created_at
        LIMIT $1`,
      [limit],
    );
    return rows;
  }

  async reportsAbout(groupId: string): Promise<GroupReportRow[]> {
    const { rows } = await this.pool.query<GroupReportRow>(
      `SELECT ${REPORT_COLUMNS}
         FROM report r
         JOIN user_account reporter ON reporter.id = r.reporter_id
         JOIN user_group g ON g.id::text = r.subject_id
        WHERE r.subject_type = 'group' AND r.subject_id = $1::text
        ORDER BY r.created_at DESC
        LIMIT 100`,
      [groupId],
    );
    return rows;
  }

  async decisionsAbout(groupId: string): Promise<GroupDecisionRow[]> {
    const { rows } = await this.pool.query<GroupDecisionRow>(
      `SELECT d.id, u.username AS moderator, d.subject_id, d.outcome, d.reason, d.created_at
         FROM moderation_decision d
         JOIN user_account u ON u.id = d.moderator_id
        WHERE d.subject_type = 'group' AND d.subject_id = $1::text
        ORDER BY d.created_at DESC`,
      [groupId],
    );
    return rows;
  }

  async appealNotes(decisionId: string): Promise<GroupAppealRow[]> {
    const { rows } = await this.pool.query<GroupAppealRow>(
      `SELECT a.id, a.decision_id, u.username AS author, a.body, a.created_at
         FROM appeal_note a
         JOIN user_account u ON u.id = a.author_id
        WHERE a.decision_id = $1
        ORDER BY a.created_at, a.id`,
      [decisionId],
    );
    return rows;
  }

  async appeal(decisionId: string, authorId: string, body: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO appeal_note (decision_id, author_id, body) VALUES ($1, $2, $3)`,
      [decisionId, authorId, body],
    );
  }

  /** Whether this member owns this group now. */
  async isOwner(groupId: string, userId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM group_member WHERE group_id = $1 AND user_id = $2 AND role = 'owner'`,
      [groupId, userId],
    );
    return rowCount === 1;
  }

  /**
   * One decision about a group, and everything it does, in one transaction.
   * `conflict` when the group is not in the state the action needs (closing a
   * closed group, reopening an open one); `nothing` when a removal named
   * nothing that is still standing in the group.
   */
  async decide(
    input: GroupDecisionInput,
  ): Promise<{ decisionId: string; answered: number } | 'conflict' | 'nothing'> {
    return this.inTransaction(async (client) => {
      const { rows: locked } = await client.query<{
        closed_at: Date | null;
        closed_reason: string | null;
        description: string | null;
      }>(`SELECT closed_at, closed_reason, description FROM user_group WHERE id = $1 FOR UPDATE`, [
        input.groupId,
      ]);
      const before = locked[0];
      if (before === undefined) return 'conflict';
      const action = input.action;
      if (action.kind === 'close' && before.closed_at !== null) return 'conflict';
      if (action.kind === 'reopen' && before.closed_at === null) return 'conflict';

      const previous: Record<string, unknown> = {
        closed_at: before.closed_at?.toISOString() ?? null,
        closed_reason: before.closed_reason,
      };

      // The content, as it was, before anything changes.
      let removed: {
        id: string;
        author: string;
        body: string | null;
        card_kind: string | null;
        card_id: string | null;
        conversation_id: string;
      }[] = [];
      if (action.kind === 'remove') {
        if (action.messageIds.length > 0) {
          const { rows } = await client.query<(typeof removed)[number]>(
            `SELECT m.id, u.username AS author, m.body, m.card_kind, m.card_id, m.conversation_id
               FROM message m
               JOIN conversation c ON c.id = m.conversation_id
               JOIN user_account u ON u.id = m.author_id
              WHERE m.id = ANY($1::uuid[]) AND c.group_id = $2 AND m.removed_at IS NULL
              FOR UPDATE OF m`,
            [action.messageIds, input.groupId],
          );
          removed = rows;
        }
        const description = action.description && before.description !== null;
        if (removed.length === 0 && !description) return 'nothing';
        previous.messages = removed;
        if (description) previous.description = before.description;
      }

      const { rows: made } = await client.query<{ id: string }>(
        `INSERT INTO moderation_decision (moderator_id, subject_type, subject_id, outcome, reason)
         VALUES ($1, 'group', $2::text, $3, $4) RETURNING id`,
        [input.moderatorId, input.groupId, OUTCOME[action.kind], input.reason],
      );
      const decisionId = made[0]?.id ?? '';

      if (action.kind === 'close') {
        await client.query(
          `UPDATE user_group SET closed_at = now(), closed_reason = $2, closed_decision_id = $3
            WHERE id = $1`,
          [input.groupId, input.reason, decisionId],
        );
      } else if (action.kind === 'reopen') {
        await client.query(
          `UPDATE user_group SET closed_at = NULL, closed_reason = NULL, closed_decision_id = NULL
            WHERE id = $1`,
          [input.groupId],
        );
      } else if (action.kind === 'remove') {
        if (removed.length > 0) {
          await client.query(
            `UPDATE message
                SET body = NULL, card_kind = NULL, card_id = NULL,
                    removed_at = now(), removed_by = $2, removed_kind = 'moderator'
              WHERE id = ANY($1::uuid[])`,
            [removed.map((m) => m.id), input.moderatorId],
          );
        }
        if (previous.description !== undefined) {
          await client.query(`UPDATE user_group SET description = NULL WHERE id = $1`, [
            input.groupId,
          ]);
        }
      }

      // Only open reports that are about this group.
      const { rowCount } = await client.query(
        `UPDATE report SET decision_id = $1
          WHERE id = ANY($2::uuid[]) AND decision_id IS NULL
            AND subject_type = 'group' AND subject_id = $3::text`,
        [decisionId, input.reportIds, input.groupId],
      );

      await client.query(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
         VALUES ($1::uuid, $2, 'user_group', $3::text, $4, $5::jsonb, $6::jsonb)`,
        [
          input.moderatorId,
          AUDIT_ACTION[action.kind],
          input.groupId,
          input.reason,
          JSON.stringify(previous),
          JSON.stringify({
            decision_id: decisionId,
            outcome: OUTCOME[action.kind],
            reports_answered: rowCount ?? 0,
            ...(action.kind === 'remove'
              ? {
                  messages_removed: removed.map((m) => m.id),
                  description_removed: previous.description !== undefined,
                }
              : {}),
          }),
        ],
      );
      return { decisionId, answered: rowCount ?? 0 };
    });
  }

  private async inTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await run(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
