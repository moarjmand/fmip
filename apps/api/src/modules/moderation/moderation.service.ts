import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import {
  type AppealNote,
  REPORT_REASONS,
  type Report,
  type ReportReason,
  type Sanction,
  type SanctionScope,
  type SubmitReportRequest,
} from '@fmip/contracts';
import { PG_POOL } from '../../database/database.module';
import { ModerationStore, type SanctionRow } from './internal/moderation-store';

export type ModerationOutcomeResult =
  | { ok: true; filed: boolean }
  | { ok: false; reason: 'unknown_subject' | 'self' | 'invalid'; fields?: Record<string, string> };

export type AppealResult =
  | { ok: true }
  | {
      ok: false;
      reason: 'unknown_sanction' | 'not_yours' | 'invalid';
      fields?: Record<string, string>;
    };

const MAX_DETAIL = 2_000;
const MAX_APPEAL = 4_000;

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

  constructor(@Inject(PG_POOL) pool: Pool) {
    this.store = new ModerationStore(pool);
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
