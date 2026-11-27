import {
  MAX_REPORT_DETAIL,
  REPORT_REASONS,
  type ReportReason,
  type SanctionScope,
} from '@fmip/contracts';
import type { MessageKey } from '@/i18n/messages';

/**
 * Reporting a member and reading one's own restrictions on the web (T-1973).
 *
 * The rules are the API's: who can be reported, which reasons exist, how long
 * a detail may be, and that an appeal is written once. What is here is the
 * words for each value, and the one thing the web adds to a report: when it is
 * made from a message, the message it was made from.
 */

/** Each reason the API takes, and its words. A reason added to the contract and not here is a type error. */
export const REPORT_REASON_LABELS: Record<ReportReason, MessageKey> = {
  spam: 'report.reason.spam',
  abuse: 'report.reason.abuse',
  impersonation: 'report.reason.impersonation',
  other: 'report.reason.other',
};

/** What a sanction restricts, in words. A scope added to the contract and not here is a type error. */
export const SANCTION_SCOPE_LABELS: Record<SanctionScope, MessageKey> = {
  contact: 'restrictions.scope.contact',
  messaging: 'restrictions.scope.messaging',
};

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value);
}

/**
 * The message a report was made from (T-1973).
 *
 * The API's report subjects are a member and a group (`REPORT_SUBJECTS`):
 * there is no message subject. A report from a message is therefore a report
 * of its author, and the message is named in the detail -- by its id and its
 * conversation's, never by copying its words, which are the author's and stay
 * where they were written.
 */
export interface ReportedMessage {
  conversationId: string;
  messageId: string;
}

function reference(message: ReportedMessage): string {
  return `Reported from message ${message.messageId} in conversation ${message.conversationId}.`;
}

/** The longest note a member may write: the API's cap, less the message's reference when there is one. */
export function reportNoteLimit(message: ReportedMessage | null): number {
  return message === null ? MAX_REPORT_DETAIL : MAX_REPORT_DETAIL - reference(message).length - 2;
}

/** The detail sent to the API: the member's own words, after the message's reference when there is one. */
export function reportDetail(note: string, message: ReportedMessage | null): string | null {
  const said = note.trim();
  if (message === null) return said === '' ? null : said;
  return said === '' ? reference(message) : `${reference(message)}\n\n${said}`;
}
