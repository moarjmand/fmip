import { REPORT_REASONS, type ReportReason } from '@fmip/contracts';
import type { MessageKey } from '@/i18n/messages';

/**
 * Reporting a member and reading one's own restrictions on the web (T-1973).
 *
 * The rules are the API's: who can be reported, which reasons exist, how long
 * a detail may be, and that an appeal is written once. What is here is the
 * words for each value.
 *
 * A report made from a message is a report of its author. The API has no
 * message subject (`REPORT_SUBJECTS` is a member and a group), and nothing on
 * the server checks that a message id typed into a detail is that member's,
 * in a conversation the reporter is in -- so the web sends no message id at
 * all rather than a reference nobody has verified. The member says in the
 * details what the message was.
 */

/** Each reason the API takes, and its words. A reason added to the contract and not here is a type error. */
export const REPORT_REASON_LABELS: Record<ReportReason, MessageKey> = {
  spam: 'report.reason.spam',
  abuse: 'report.reason.abuse',
  impersonation: 'report.reason.impersonation',
  other: 'report.reason.other',
};

/**
 * What a sanction restricts, in words: the contract's scopes, and the two the
 * schema also accepts (`groups`, `post`; the match panel's migration) so that
 * a row made some other way is named rather than breaking Settings.
 */
const SANCTION_SCOPE_LABELS: Record<string, MessageKey> = {
  contact: 'restrictions.scope.contact',
  messaging: 'restrictions.scope.messaging',
  groups: 'restrictions.scope.groups',
  post: 'restrictions.scope.post',
};

/** The words for a scope; one this code has never heard of is "another part of your account", never a raw key. */
export function sanctionScopeLabel(scope: string): MessageKey {
  return SANCTION_SCOPE_LABELS[scope] ?? 'restrictions.scope.other';
}

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value);
}
