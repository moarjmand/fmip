import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import {
  type GroupAppealNote,
  type GroupAppealResponse,
  type GroupClosure,
  type GroupDecisionOutcome,
  type GroupDecisionResponse,
  type GroupModerationView,
  type GroupQueueSubject,
  MAX_GROUP_DECISION_REASON,
  type QueuedReport,
  type RemoveGroupContentRequest,
  type ReportReason,
} from '@fmip/contracts';
import { PG_POOL } from '../../database/database.module';
import {
  type GroupAction,
  type GroupAppealRow,
  GroupModerationStore,
  type GroupReportRow,
  type ModeratedGroupRow,
} from './internal/group-moderation-store';

export type GroupDecisionResult =
  | { ok: true; value: GroupDecisionResponse }
  | {
      ok: false;
      reason: 'invalid' | 'not_found' | 'conflict' | 'nothing';
      fields?: Record<string, string>;
    };

export type GroupAppealResult =
  | { ok: true; value: GroupAppealResponse }
  | {
      ok: false;
      reason: 'not_found' | 'not_owner' | 'not_closed' | 'invalid';
      fields?: Record<string, string>;
    };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_APPEAL = 4_000;
const MAX_REMOVALS = 100;

function closureOf(row: {
  closed_at: Date | null;
  closed_reason: string | null;
  closed_decision_id: string | null;
}): GroupClosure | null {
  if (row.closed_at === null || row.closed_reason === null || row.closed_decision_id === null) {
    return null;
  }
  return {
    at: row.closed_at.toISOString(),
    reason: row.closed_reason,
    decision_id: row.closed_decision_id,
  };
}

function queuedReport(row: GroupReportRow): QueuedReport {
  return {
    id: row.report_id,
    reporter: row.reporter,
    subject_type: 'group',
    subject_id: row.group_id,
    reason: row.reason as ReportReason,
    detail: row.detail,
    created_at: row.created_at.toISOString(),
    decision_id: row.decision_id,
    suggestion: null,
  };
}

function note(row: GroupAppealRow): GroupAppealNote {
  return {
    id: row.id,
    decision_id: row.decision_id,
    author: row.author,
    body: row.body,
    created_at: row.created_at.toISOString(),
  };
}

/**
 * The reason and the reports a group decision names, checked. The reason is
 * checked first and on its own, so a request without one is refused for that
 * whatever else is wrong with it (rule 10).
 */
export function checkGroupDecision(body: {
  reason?: unknown;
  report_ids?: unknown;
}):
  | { ok: true; reason: string; reportIds: string[] }
  | { ok: false; fields: Record<string, string> } {
  const reason = typeof body.reason === 'string' ? body.reason.trim() : '';
  if (reason === '') return { ok: false, fields: { reason: 'Say why: a reason is required.' } };
  if (reason.length > MAX_GROUP_DECISION_REASON) {
    return { ok: false, fields: { reason: `At most ${MAX_GROUP_DECISION_REASON} characters.` } };
  }
  const ids = body.report_ids ?? [];
  if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string' && UUID.test(id))) {
    return { ok: false, fields: { report_ids: 'Report ids.' } };
  }
  return { ok: true, reason, reportIds: ids as string[] };
}

/**
 * Administrators and groups (blueprint 10.4, T-1025, D-135).
 *
 * A moderator or an administrator closes a group, reopens it, removes its
 * content, or judges its reports groundless -- each a `moderation_decision`
 * about the group with its reason, the reports it answers and an audit row
 * holding the state before (rule 10). Closing is what makes the group
 * read-only; that rule is the schema's (`refuse_write_in_closed_group`), so
 * this service only records the decision.
 *
 * The owner appeals a closure the way a member appeals a sanction: with notes
 * (T-211), on the decision that closed it.
 */
@Injectable()
export class GroupModerationService {
  private readonly store: GroupModerationStore;

  constructor(@Inject(PG_POOL) pool: Pool) {
    this.store = new GroupModerationStore(pool);
  }

  /** For `POST /reports`: the group a reporter may name, or null. */
  reportable(slug: string, reporterId: string): Promise<{ id: string } | null> {
    return this.store.reportable(slug, reporterId);
  }

  /** Open reports about groups, one entry per group, oldest waiter first. */
  async queue(limit: number): Promise<GroupQueueSubject[]> {
    const rows = await this.store.openReports(limit);
    const byGroup = new Map<string, GroupQueueSubject>();
    for (const row of rows) {
      const report = queuedReport(row);
      const existing = byGroup.get(row.group_id);
      if (existing === undefined) {
        byGroup.set(row.group_id, {
          subject_type: 'group',
          subject_id: row.group_id,
          slug: row.slug,
          name: row.name,
          visibility: row.visibility,
          closed: closureOf(row),
          reports: [report],
          waiting_since: report.created_at,
        });
      } else {
        existing.reports.push(report);
      }
    }
    return [...byGroup.values()];
  }

  async view(slug: string): Promise<GroupModerationView | null> {
    const group = await this.store.bySlug(slug);
    if (group === null) return null;
    const closed = closureOf(group);
    const [reports, decisions, appeal] = await Promise.all([
      this.store.reportsAbout(group.id),
      this.store.decisionsAbout(group.id),
      closed === null ? Promise.resolve([]) : this.store.appealNotes(closed.decision_id),
    ]);
    return {
      id: group.id,
      slug: group.slug,
      name: group.name,
      description: group.description,
      visibility: group.visibility,
      member_count: Number(group.member_count),
      owner: group.owner,
      closed,
      reports: reports.map(queuedReport),
      decisions: decisions.map((row) => ({
        id: row.id,
        moderator: row.moderator,
        subject_type: 'group',
        subject_id: row.subject_id,
        outcome: row.outcome as GroupDecisionOutcome,
        reason: row.reason,
        created_at: row.created_at.toISOString(),
      })),
      appeal: appeal.map(note),
    };
  }

  close(moderatorId: string, slug: string, body: unknown): Promise<GroupDecisionResult> {
    return this.decide(moderatorId, slug, body, () => ({ kind: 'close' }));
  }

  reopen(moderatorId: string, slug: string, body: unknown): Promise<GroupDecisionResult> {
    return this.decide(moderatorId, slug, body, () => ({ kind: 'reopen' }));
  }

  dismiss(moderatorId: string, slug: string, body: unknown): Promise<GroupDecisionResult> {
    return this.decide(moderatorId, slug, body, () => ({ kind: 'dismiss' }));
  }

  removeContent(moderatorId: string, slug: string, body: unknown): Promise<GroupDecisionResult> {
    return this.decide(moderatorId, slug, body, (request): GroupAction | Record<string, string> => {
      const r = request as RemoveGroupContentRequest;
      const ids = r.message_ids ?? [];
      if (
        !Array.isArray(ids) ||
        ids.length > MAX_REMOVALS ||
        !ids.every((id) => typeof id === 'string' && UUID.test(id))
      ) {
        return { message_ids: `Up to ${MAX_REMOVALS} message ids.` };
      }
      if (ids.length === 0 && r.description !== true) {
        return { message_ids: 'Name the messages to remove, or the description.' };
      }
      return { kind: 'remove', messageIds: ids, description: r.description === true };
    });
  }

  /** The owner's appeal of the closure, and the notes on it so far. */
  async appealView(userId: string, slug: string): Promise<GroupAppealResult> {
    const found = await this.ownersClosure(userId, slug);
    if (!found.ok) return found;
    const notes = await this.store.appealNotes(found.closed.decision_id);
    return { ok: true, value: { closed: found.closed, notes: notes.map(note) } };
  }

  async appeal(userId: string, slug: string, body: unknown): Promise<GroupAppealResult> {
    const text =
      typeof (body as { body?: unknown } | null)?.body === 'string'
        ? (body as { body: string }).body.trim()
        : '';
    if (text === '') {
      return { ok: false, reason: 'invalid', fields: { body: 'Say why you are appealing.' } };
    }
    if (text.length > MAX_APPEAL) {
      return {
        ok: false,
        reason: 'invalid',
        fields: { body: `At most ${MAX_APPEAL} characters.` },
      };
    }
    const found = await this.ownersClosure(userId, slug);
    if (!found.ok) return found;
    await this.store.appeal(found.closed.decision_id, userId, text);
    return this.appealView(userId, slug);
  }

  // -------------------------------------------------------------------------

  private async ownersClosure(
    userId: string,
    slug: string,
  ): Promise<
    | { ok: true; closed: GroupClosure }
    | { ok: false; reason: 'not_found' | 'not_owner' | 'not_closed' }
  > {
    const group: ModeratedGroupRow | null = await this.store.bySlug(slug);
    if (group === null) return { ok: false, reason: 'not_found' };
    if (!(await this.store.isOwner(group.id, userId))) {
      // A stranger to an invite-only group is not told it is there.
      return group.visibility === 'invite_only'
        ? { ok: false, reason: 'not_found' }
        : { ok: false, reason: 'not_owner' };
    }
    const closed = closureOf(group);
    if (closed === null) return { ok: false, reason: 'not_closed' };
    return { ok: true, closed };
  }

  private async decide(
    moderatorId: string,
    slug: string,
    body: unknown,
    shape: (body: unknown) => GroupAction | Record<string, string>,
  ): Promise<GroupDecisionResult> {
    const request = (body ?? {}) as Record<string, unknown>;
    const checked = checkGroupDecision(request);
    if (!checked.ok) return { ok: false, reason: 'invalid', fields: checked.fields };
    const action = shape(request);
    if (!('kind' in action))
      return { ok: false, reason: 'invalid', fields: action as Record<string, string> };

    const group = await this.store.bySlug(slug);
    if (group === null) return { ok: false, reason: 'not_found' };

    const done = await this.store.decide({
      moderatorId,
      groupId: group.id,
      reason: checked.reason,
      reportIds: checked.reportIds,
      action: action as GroupAction,
    });
    if (done === 'conflict') return { ok: false, reason: 'conflict' };
    if (done === 'nothing') return { ok: false, reason: 'nothing' };
    return { ok: true, value: { decision_id: done.decisionId, answered: done.answered } };
  }
}
