/**
 * Reports, decisions and sanctions (blueprint 10.4 and 16, T-210).
 *
 * D-053 puts this in front of every surface that carries one member's words to
 * another, so the shapes exist before the messages do.
 *
 * **Every list here is deliberately short, and stays short until something
 * enforces the next entry.** A report subject nobody can report, or a sanction
 * scope no code applies, is a promise to the moderation team that the product
 * does not keep — rule 3, aimed at an operator rather than a reader. Each later
 * epic adds its own value in the same change that builds the surface it
 * protects.
 */

/** What can be reported today. Messages, groups and analyses join it with the surfaces that hold them. */
import type { LanguageModelState, ModerationSuggestion } from './intelligence';

export const REPORT_SUBJECTS = ['member', 'group'] as const;
export type ReportSubject = (typeof REPORT_SUBJECTS)[number];

/**
 * Why. The first three are the behaviours blueprint 1.6 names — spam,
 * impersonation and abuse — and `other` exists because a closed list that
 * forced everything into one of three boxes would be answered by picking the
 * nearest one. It requires a description, since "other" alone is a report
 * nobody can act on.
 */
export const REPORT_REASONS = ['spam', 'abuse', 'impersonation', 'other'] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];

/**
 * What a moderator did. `no_action` is a real outcome and is recorded like any
 * other: a report that was read and judged groundless is not the same as a
 * report nobody opened, and only one of the two needs chasing.
 */
export const MODERATION_OUTCOMES = [
  'no_action',
  'warned',
  'content_removed',
  'sanctioned',
] as const;
export type ModerationOutcome = (typeof MODERATION_OUTCOMES)[number];

/**
 * What a sanction restricts.
 *
 * `contact` is friend requests; `messaging` arrived with the conversations of
 * T-220, in the same change that built the surface it restricts. The list grows
 * that way and only that way: a scope a moderator can choose and no code
 * applies would tell the moderation team a restriction was in force.
 */
export const SANCTION_SCOPES = ['contact', 'messaging'] as const;
export type SanctionScope = (typeof SANCTION_SCOPES)[number];

/**
 * What an administrator decides about a group (T-1025, D-135): close it,
 * reopen it, remove its content, or judge its reports groundless. Kept apart
 * from `MODERATION_OUTCOMES`, which are about a member.
 */
export const GROUP_DECISION_OUTCOMES = [
  'group_closed',
  'group_reopened',
  'content_removed',
  'no_action',
] as const;
export type GroupDecisionOutcome = (typeof GROUP_DECISION_OUTCOMES)[number];

/** `POST /reports`. */
export interface SubmitReportRequest {
  subject_type: ReportSubject;
  /** For a `member`, their username; for a `group`, its slug (T-1025). */
  subject: string;
  reason: ReportReason;
  /** Required when `reason` is `other`. */
  detail?: string | null;
}

/**
 * `POST /reports`'s answer (T-1973).
 *
 * `filed: false` is not a refusal: the member already has an open report
 * about this subject, which a person will read, and one reporter's second
 * identical complaint is not a second complaint (T-210). It is said rather
 * than answered like a new report, because what they wrote this time was not
 * kept, and telling them it was would be untrue.
 */
export interface SubmitReportResponse {
  filed: boolean;
}

export interface Report {
  id: string;
  subject_type: ReportSubject;
  subject_id: string;
  reason: ReportReason;
  detail: string | null;
  /** ISO 8601. */
  created_at: string;
  /**
   * The decision that answered it, or null while it is open. One decision may
   * answer several reports: three members reporting one person is three reports
   * and one judgement.
   */
  decision_id: string | null;
}

export interface ModerationDecision {
  id: string;
  /** The moderator's username: a decision names its actor (rule 10). */
  moderator: string;
  subject_type: ReportSubject;
  subject_id: string;
  outcome: ModerationOutcome | GroupDecisionOutcome;
  reason: string;
  created_at: string;
}

export interface Sanction {
  id: string;
  /** The sanctioned member's username. */
  username: string;
  scope: SanctionScope;
  /** The group or conversation it applies to, where the scope has one. */
  scope_id: string | null;
  starts_at: string;
  /** ISO 8601, or null when `permanent`. */
  ends_at: string | null;
  permanent: boolean;
  /** Whether it is in force right now, by the server's clock. */
  active: boolean;
  lifted_at: string | null;
  lifted_by: string | null;
  lift_reason: string | null;
  /** The decision it descends from: no sanction exists without one. */
  decision_id: string;
}

export interface AppealNote {
  id: string;
  sanction_id: string;
  author: string;
  body: string;
  created_at: string;
}

/**
 * One sanction as the member it is on reads it (T-1973): the sanction, the
 * written reason of the decision it descends from, and whether they have
 * appealed it.
 *
 * The platform rules (`platform-rules@1.0.0`) promise the member is told
 * "which and why", and that every decision "can be appealed once, in
 * writing": `reason` is the why, `appealed_at` is the once.
 *
 * **Never who.** `lifted_by`, a moderator's username, is left out: the member
 * is told which decision and why, not who made it (policy section 2), and a
 * name would hand them a person to blame. Moderators read it in a member's
 * history (`MemberModerationHistory.sanctions`).
 */
export interface OwnSanction extends Omit<Sanction, 'lifted_by'> {
  /** The decision's written reason: no decision exists without one. */
  reason: string;
  /** ISO 8601: when this member appealed it, or null while they have not. */
  appealed_at: string | null;
}

/**
 * The decisions about a member that carry no sanction and are shown to them
 * (T-1973): a warning, and content removed. A `sanctioned` decision is shown
 * as its sanction; `no_action` decided nothing against them, so there is
 * nothing to appeal.
 */
export const APPEALABLE_DECISION_OUTCOMES = ['warned', 'content_removed'] as const;
export type AppealableDecisionOutcome = (typeof APPEALABLE_DECISION_OUTCOMES)[number];

/**
 * One such decision as the member it is about reads it (T-1973): what was
 * decided, why, when, and whether they have appealed it. Never who decided
 * (policy section 2). A `content_removed` decision names no item: the
 * decision does not record one, and the removed words are never repeated.
 */
export interface OwnDecision {
  id: string;
  outcome: AppealableDecisionOutcome;
  /** The moderator's written reason, which their form says the member reads. */
  reason: string;
  /** ISO 8601. */
  created_at: string;
  /** ISO 8601: when this member appealed it, or null while they have not. */
  appealed_at: string | null;
}

/**
 * What a member is told about their own standing.
 *
 * A sanctioned member is told, and told when it ends. A restriction the member
 * cannot see is one they cannot appeal, and blueprint 10.4 asks for appeals.
 * Since T-1973 the other decisions against them are told too, so that every
 * decision can be appealed once, as the platform rules promise.
 */
export interface OwnStandingResponse {
  sanctions: OwnSanction[];
  decisions: OwnDecision[];
}

/**
 * A member's appeal as a moderator reads it (T-1973): who appealed, what
 * against -- a sanction (its scope and whether it is still in force) or a
 * decision -- the decision's reason, and the appeal's words.
 */
export interface QueuedAppeal {
  /** The appeal note's id. */
  id: string;
  /** The member who appealed. */
  username: string;
  /** The sanction appealed, or null when the appeal is against a decision with none. */
  sanction_id: string | null;
  scope: SanctionScope | null;
  /** Whether that sanction is in force now; null for a decision. */
  active: boolean | null;
  decision_id: string;
  outcome: ModerationOutcome;
  decision_reason: string;
  body: string;
  /** ISO 8601. */
  created_at: string;
}

/** An appeal's longest text (T-211): the same cap for a sanction and a group's closure. */
export const MAX_APPEAL = 4_000;

/** A report's longest detail (T-211). */
export const MAX_REPORT_DETAIL = 2_000;

// ---------------------------------------------------------------------------
// The moderator's queue (blueprint 16, T-212)
// ---------------------------------------------------------------------------

/** One open report as a moderator sees it: with who filed it. */
export interface QueuedReport extends Report {
  reporter: string;
  /** What the language model suggested, when one is configured and has answered (T-441); a moderator's to ignore. */
  suggestion: ModerationSuggestion | null;
}

/**
 * Everything open about one subject, together.
 *
 * The queue groups rather than lists, because three members reporting one
 * person is three reports and **one** judgement — and a moderator who is shown
 * them one at a time either decides three times or decides once and leaves two
 * in a queue nobody will look at again.
 */
export interface QueueSubject {
  subject_type: ReportSubject;
  subject_id: string;
  /** The member's username, when the subject is a member. */
  username: string;
  display_name: string;
  reports: QueuedReport[];
  /** ISO 8601 of the oldest open report: what the queue is ordered by. */
  waiting_since: string;
  /** Sanctions already in force on them, so a moderator is not deciding blind. */
  active_sanctions: number;
}

/**
 * Everything open about one group (T-1025): its reports together, with what
 * the group is and whether it is already closed, so a moderator can close it,
 * remove its content or answer its reports from the queue.
 */
export interface GroupQueueSubject {
  subject_type: 'group';
  subject_id: string;
  slug: string;
  name: string;
  visibility: string;
  closed: GroupClosure | null;
  reports: QueuedReport[];
  waiting_since: string;
}

/** Why and when an administrator closed a group; the decision it descends from. */
export interface GroupClosure {
  at: string;
  reason: string;
  decision_id: string;
}

export interface ModerationQueueResponse {
  subjects: QueueSubject[];
  /** Open reports about groups, by group, oldest waiter first (T-1025). */
  groups: GroupQueueSubject[];
  /** Whether a model is there to suggest at all, so an empty `suggestion` is read the right way. */
  assistant: LanguageModelState;
  /** Open reports in total, so a page showing one screen can say what it is not showing. */
  open_total: number;
  /** Members' appeals of sanctions and decisions, newest first (T-1973). */
  appeals: QueuedAppeal[];
}

/** What a moderator asks for when a decision carries a restriction. */
export interface SanctionRequest {
  scope: SanctionScope;
  /** Whole days from now. Exactly one of `days` and `permanent`. */
  days?: number;
  permanent?: boolean;
}

/**
 * `POST /admin/moderation/decisions`.
 *
 * One decision answers the reports it names. `sanction` is required when the
 * outcome is `sanctioned` and refused otherwise: an outcome that says a
 * restriction was applied and applies none is a record of something that did
 * not happen.
 */
export interface DecideRequest {
  /** The member the decision is about. */
  subject: string;
  /** The open reports it answers. May be empty for a decision nobody reported. */
  report_ids?: string[];
  outcome: ModerationOutcome;
  reason: string;
  sanction?: SanctionRequest;
}

export interface LiftSanctionRequest {
  reason: string;
}

/** Everything a moderator needs about one member before deciding. */
export interface MemberModerationHistory {
  username: string;
  reports_about_them: QueuedReport[];
  decisions: ModerationDecision[];
  sanctions: Sanction[];
  /** Their appeals of those sanctions and decisions, newest first (T-1973). */
  appeals: QueuedAppeal[];
}

// ---------------------------------------------------------------------------
// Administrators and groups (blueprint 10.4, T-1025, D-135)
// ---------------------------------------------------------------------------

export const MAX_GROUP_DECISION_REASON = 500;

/** An appeal note on a group's closure: the owner's words or a moderator's. */
export interface GroupAppealNote {
  id: string;
  decision_id: string;
  author: string;
  body: string;
  created_at: string;
}

/** `GET /admin/moderation/groups/:slug`: everything a moderator needs about one group. */
export interface GroupModerationView {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: string;
  member_count: number;
  /** The owner's username. */
  owner: string | null;
  closed: GroupClosure | null;
  /** Open and answered, newest first. */
  reports: QueuedReport[];
  decisions: ModerationDecision[];
  /** Notes on the current closure's appeal, oldest first; empty while open. */
  appeal: GroupAppealNote[];
}

/**
 * `POST /admin/moderation/groups/:slug/close`, `/reopen` and `/dismissal`:
 * each a decision with a reason, answering the reports it names.
 */
export interface GroupDecisionRequest {
  reason: string;
  report_ids?: string[];
}

/**
 * `POST /admin/moderation/groups/:slug/removal`: removes the named messages
 * of the group's conversations (as tombstones) and, when asked, its
 * description -- each as it was kept in the audit row.
 */
export interface RemoveGroupContentRequest extends GroupDecisionRequest {
  message_ids?: string[];
  description?: boolean;
}

export interface GroupDecisionResponse {
  decision_id: string;
  answered: number;
}

/** `GET`/`POST /groups/:slug/closure/appeal`: the owner's appeal of a closure (T-211's notes). */
export interface GroupAppealResponse {
  closed: GroupClosure;
  notes: GroupAppealNote[];
}

export interface GroupAppealRequest {
  body: string;
}
