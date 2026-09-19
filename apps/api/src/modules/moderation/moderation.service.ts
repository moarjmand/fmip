import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import {
  type AppealNote,
  type DecideRequest,
  MODERATION_OUTCOMES,
  type MemberModerationHistory,
  type ModerationDecision,
  type ModerationOutcome,
  type ModerationQueueResponse,
  REPORT_REASONS,
  type Report,
  type ReportReason,
  SANCTION_SCOPES,
  type Sanction,
  type SanctionScope,
  type SubmitReportRequest,
} from '@fmip/contracts';
import { PG_POOL } from '../../database/database.module';
import {
  type DecisionRow,
  ModerationQueueStore,
  ModerationStore,
  type QueueRow,
  type SanctionRow,
} from './internal/moderation-store';
import { ModerationAssistService } from '../moderation-assist/moderation-assist.service';
import { NotificationsService } from '../notifications/notifications.service';

export type ModerationOutcomeResult =
  | { ok: true; filed: boolean }
  | { ok: false; reason: 'unknown_subject' | 'self' | 'invalid'; fields?: Record<string, string> };

export type DecideResult =
  | { ok: true; decision_id: string; answered: number }
  | { ok: false; reason: 'unknown_subject' | 'invalid'; fields?: Record<string, string> };

export type AppealResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'unknown_sanction' | 'not_yours' | 'invalid';
      fields?: Record<string, string>;
    };

const MAX_DETAIL = 2_000;
const MAX_APPEAL = 4_000;

function queued(row: QueueRow) {
  return {
    id: row.report_id,
    reporter: row.reporter,
    subject_type: 'member' as const,
    subject_id: row.subject_id,
    reason: row.reason as ReportReason,
    detail: row.detail,
    created_at: row.created_at.toISOString(),
    decision_id: null,
    // Filled in by the queue from the assistant's rows; a history has no assistant beside it.
    suggestion: null,
  };
}

function decisionShape(row: DecisionRow): ModerationDecision {
  return {
    id: row.id,
    moderator: row.moderator,
    subject_type: 'member',
    subject_id: row.subject_id,
    outcome: row.outcome as ModerationOutcome,
    reason: row.reason,
    created_at: row.created_at.toISOString(),
  };
}

function shape(row: SanctionRow): Sanction {
  return {
    id: row.id,
    username: row.username,
    scope: row.scope as SanctionScope,
    scope_id: row.scope_id,
    starts_at: row.starts_at.toISOString(),
    ends_at: row.ends_at?.toISOString() ?? null,
    permanent: row.permanent,
    active: row.active,
    lifted_at: row.lifted_at?.toISOString() ?? null,
    lifted_by: row.lifted_by,
    lift_reason: row.lift_reason,
    decision_id: row.decision_id,
  };
}

/**
 * The moderation boundary (blueprint 10.4, T-211).
 *
 * **Reporting is never gated.** Filing a report needs a session and nothing
 * else — no verified e-mail, and emphatically not an unsanctioned account. It
 * is the same rule the social boundary follows in the other direction: reaching
 * another member is gated, getting help about one is not. A member who has been
 * restricted for something unrelated must still be able to report the person
 * harassing them, and a product that got this backwards would silence exactly
 * the people who most need to be heard.
 *
 * **A member can always read their own standing.** Blueprint 10.4 asks for
 * appeals, and a restriction the member cannot see is one they cannot appeal.
 */
@Injectable()
export class ModerationService {
  private readonly store: ModerationStore;
  private readonly queueStore: ModerationQueueStore;

  constructor(
    @Inject(PG_POOL) pool: Pool,
    private readonly notifications: NotificationsService,
    private readonly assist: ModerationAssistService,
  ) {
    this.store = new ModerationStore(pool);
    this.queueStore = new ModerationQueueStore(pool);
  }

  async report(reporterId: string, body: SubmitReportRequest): Promise<ModerationOutcomeResult> {
    const fields: Record<string, string> = {};

    // `member` is the only subject that exists (T-210), and the contract says
    // so; a request naming another kind is refused rather than stored against a
    // table nothing can open.
    if (body.subject_type !== 'member') fields.subject_type = 'Must be "member".';
    if (!(REPORT_REASONS as readonly string[]).includes(body.reason)) {
      fields.reason = `Must be one of ${REPORT_REASONS.join(', ')}.`;
    }
    const detail = typeof body.detail === 'string' ? body.detail.trim() : '';
    if (body.reason === 'other' && detail === '') {
      fields.detail = 'Say what happened: "other" on its own is a report nobody can act on.';
    }
    if (detail.length > MAX_DETAIL) fields.detail = `At most ${MAX_DETAIL} characters.`;
    if (typeof body.subject !== 'string' || body.subject.trim() === '') {
      fields.subject = 'Name the member.';
    }
    if (Object.keys(fields).length > 0) return { ok: false, reason: 'invalid', fields };

    const subject = await this.store.memberByUsername(body.subject.trim());
    if (subject === null) return { ok: false, reason: 'unknown_subject' };
    if (subject.id === reporterId) return { ok: false, reason: 'self' };

    const filed = await this.store.file(
      reporterId,
      'member',
      subject.id,
      body.reason as ReportReason,
      detail === '' ? null : detail,
    );
    // `filed: false` means an open report about this subject already stands.
    // It is not an error: the member has reported them, which is what they
    // wanted, and a second identical complaint is not a second complaint.
    return { ok: true, filed };
  }

  async ownReports(reporterId: string): Promise<Report[]> {
    const rows = await this.store.filedBy(reporterId);
    return rows.map((row) => ({
      id: row.id,
      subject_type: 'member',
      subject_id: row.subject_id,
      reason: row.reason as ReportReason,
      detail: row.detail,
      created_at: row.created_at.toISOString(),
      decision_id: row.decision_id,
    }));
  }

  async standing(userId: string): Promise<Sanction[]> {
    return (await this.store.sanctionsOn(userId)).map(shape);
  }

  /**
   * The active sanction of a scope, if there is one.
   *
   * Read by the social boundary after the database has already refused a write
   * (SQLSTATE PL004), so that the member is told what stopped them rather than
   * being handed a bare failure. The refusal is still the database's: this is
   * the explanation, not the check, and asking first would be a check that a
   * sanction expiring in between could make wrong.
   */
  async activeSanction(userId: string, scope: SanctionScope): Promise<Sanction | null> {
    const rows = await this.store.sanctionsOn(userId);
    return rows.filter((row) => row.active && row.scope === scope).map(shape)[0] ?? null;
  }

  async appeal(userId: string, sanctionId: string, body: string): Promise<AppealResult> {
    const text = body.trim();
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

    const sanction = await this.store.sanction(sanctionId);
    if (sanction === null) return { ok: false, reason: 'unknown_sanction' };
    // A member appeals their own sanction. A moderator's note on somebody
    // else's is part of the queue (T-212), not of this route.
    if (sanction.user_id !== userId) return { ok: false, reason: 'not_yours' };

    await this.store.appeal(sanctionId, userId, text);
    return { ok: true };
  }

  // -------------------------------------------------------------------------
  // The moderator's half (T-212)
  // -------------------------------------------------------------------------

  /**
   * The queue, grouped by subject.
   *
   * Grouped rather than listed because three members reporting one person is
   * three reports and one judgement. A moderator shown them one at a time
   * either decides three times or decides once and leaves two behind in a queue
   * nobody looks at again.
   */
  async queue(limit: number): Promise<ModerationQueueResponse> {
    const { rows, total } = await this.queueStore.queue(limit);
    // The assistant's suggestions beside the reports (T-441): read with the
    // queue, never a hand on it, and the queue says whether there is an
    // assistant at all so an empty one is read the right way.
    const suggestions = await this.assist.forReports(rows.map((row) => row.report_id));
    const bySubject = new Map<string, ModerationQueueResponse['subjects'][number]>();

    for (const row of rows) {
      const existing = bySubject.get(row.subject_id);
      const report = { ...queued(row), suggestion: suggestions.get(row.report_id) ?? null };
      if (existing === undefined) {
        bySubject.set(row.subject_id, {
          subject_type: 'member',
          subject_id: row.subject_id,
          username: row.username,
          display_name: row.display_name,
          reports: [report],
          waiting_since: report.created_at,
          active_sanctions: Number(row.active_sanctions),
        });
      } else {
        existing.reports.push(report);
      }
    }

    // The rows arrive oldest first, so each group's first report is its oldest
    // and the insertion order is already "who has waited longest".
    return {
      subjects: [...bySubject.values()],
      open_total: total,
      assistant: this.assist.assistant(),
    };
  }

  async history(username: string): Promise<MemberModerationHistory | null> {
    const member = await this.store.memberByUsername(username);
    if (member === null) return null;

    const [reports, decisions, sanctions] = await Promise.all([
      this.queueStore.reportsAbout(member.id),
      this.queueStore.decisionsAbout(member.id),
      this.store.sanctionsOn(member.id),
    ]);
    return {
      username: member.username,
      reports_about_them: reports.map(queued),
      decisions: decisions.map(decisionShape),
      sanctions: sanctions.map(shape),
    };
  }

  /**
   * Record a decision, answer the reports it names, apply any sanction and
   * write the audit row: one transaction (D-046).
   *
   * The outcome and the sanction must agree. An outcome of `sanctioned` with no
   * restriction is a record of something that did not happen, and a restriction
   * under any other outcome is one nobody decided.
   */
  async decide(moderatorId: string, body: DecideRequest): Promise<DecideResult> {
    const fields: Record<string, string> = {};

    if (!(MODERATION_OUTCOMES as readonly string[]).includes(body?.outcome)) {
      fields.outcome = `Must be one of ${MODERATION_OUTCOMES.join(', ')}.`;
    }
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason === '') fields.reason = 'Say why. A decision with no reason cannot be reviewed.';

    const wantsSanction = body?.sanction !== undefined && body.sanction !== null;
    if (body?.outcome === 'sanctioned' && !wantsSanction) {
      fields.sanction = 'An outcome of "sanctioned" has to carry the restriction it applied.';
    }
    if (body?.outcome !== 'sanctioned' && wantsSanction) {
      fields.sanction = 'Only an outcome of "sanctioned" carries a restriction.';
    }

    let endsAt: string | null = null;
    let permanent = false;
    if (wantsSanction) {
      const request = body.sanction as NonNullable<DecideRequest['sanction']>;
      if (!(SANCTION_SCOPES as readonly string[]).includes(request.scope)) {
        fields.scope = `Must be one of ${SANCTION_SCOPES.join(', ')}.`;
      }
      permanent = request.permanent === true;
      const days = typeof request.days === 'number' ? request.days : null;
      if (permanent && days !== null) {
        fields.days = 'A permanent restriction has no end date.';
      } else if (!permanent) {
        if (days === null || !Number.isInteger(days) || days < 1 || days > 3650) {
          fields.days = 'Whole days from 1 to 3650, or mark it permanent.';
        } else {
          endsAt = new Date(Date.now() + days * 86_400_000).toISOString();
        }
      }
    }

    if (Object.keys(fields).length > 0) return { ok: false, reason: 'invalid', fields };

    const subject = await this.store.memberByUsername(String(body.subject ?? ''));
    if (subject === null) return { ok: false, reason: 'unknown_subject' };

    const { decisionId, answered } = await this.queueStore.decide({
      moderatorId,
      subjectId: subject.id,
      reportIds: Array.isArray(body.report_ids) ? body.report_ids : [],
      outcome: body.outcome as ModerationOutcome,
      reason,
      sanction: wantsSanction
        ? {
            scope: (body.sanction as NonNullable<DecideRequest['sanction']>).scope,
            endsAt,
            permanent,
          }
        : null,
    });

    // **The source is deliberately null.** Policy section 2 promises the member
    // is told *which* decision was made and *why*, not who made it: a
    // notification naming the moderator would hand a sanctioned member a person
    // to blame, and the whole point of a moderation queue is that the decision
    // belongs to the platform. The audit row names them, where it is read by
    // people who can be held responsible for reading it (rule 10).
    await this.notifications.emit({
      userId: subject.id,
      kind: 'moderation_decision',
      subjectType: 'member',
      subjectId: subject.id,
      dedupeKey: `moderation_decision:${decisionId}`,
    });
    return { ok: true, decision_id: decisionId, answered };
  }

  /** `false` when no sanction of that id was still in force. */
  lift(moderatorId: string, sanctionId: string, reason: string): Promise<boolean> {
    return this.queueStore.lift(moderatorId, sanctionId, reason.trim());
  }

  async appealNotes(sanctionId: string): Promise<AppealNote[]> {
    const rows = await this.store.appealNotes(sanctionId);
    return rows.map((row) => ({
      id: row.id,
      sanction_id: sanctionId,
      author: row.author,
      body: row.body,
      created_at: row.created_at.toISOString(),
    }));
  }
}
