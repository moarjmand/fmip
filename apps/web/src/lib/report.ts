import {
  type AppealableDecisionOutcome,
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
 * What a sanction restricts, in words. Keyed by the contract's union, so a
 * scope added to `SANCTION_SCOPES` without words here does not compile.
 */
const SANCTION_SCOPE_LABELS: Record<SanctionScope, MessageKey> = {
  contact: 'restrictions.scope.contact',
  messaging: 'restrictions.scope.messaging',
};

/**
 * The two scopes the schema also accepts (`groups`, `post`; the groups' and
 * the match panel's migrations) without the contract offering them to a
 * moderator: a row made some other way is named rather than breaking Settings.
 */
const SCHEMA_ONLY_SCOPE_LABELS: Record<'groups' | 'post', MessageKey> = {
  groups: 'restrictions.scope.groups',
  post: 'restrictions.scope.post',
};

/** The words for a scope; one this code has never heard of is "another part of your account", never a raw key. */
export function sanctionScopeLabel(scope: string): MessageKey {
  if (Object.hasOwn(SANCTION_SCOPE_LABELS, scope))
    return SANCTION_SCOPE_LABELS[scope as SanctionScope];
  if (Object.hasOwn(SCHEMA_ONLY_SCOPE_LABELS, scope)) {
    return SCHEMA_ONLY_SCOPE_LABELS[scope as keyof typeof SCHEMA_ONLY_SCOPE_LABELS];
  }
  return 'restrictions.scope.other';
}

/** What a decision without a sanction did, in words; keyed by the contract's union for the same reason. */
export const DECISION_OUTCOME_LABELS: Record<AppealableDecisionOutcome, MessageKey> = {
  warned: 'restrictions.decision.warned',
  content_removed: 'restrictions.decision.contentRemoved',
};

export function isReportReason(value: unknown): value is ReportReason {
  return typeof value === 'string' && (REPORT_REASONS as readonly string[]).includes(value);
}
