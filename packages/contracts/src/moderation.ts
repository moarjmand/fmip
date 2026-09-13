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
export const REPORT_SUBJECTS = ['member'] as const;
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
 * What a sanction restricts. `contact` — friend requests — is the only thing
 * one member can currently aim at another, so it is the only scope that exists.
 */
export const SANCTION_SCOPES = ['contact'] as const;
export type SanctionScope = (typeof SANCTION_SCOPES)[number];

/** `POST /reports`. */
export interface SubmitReportRequest {
  subject_type: ReportSubject;
  /** For a `member`, their username. */
  subject: string;
  reason: ReportReason;
  /** Required when `reason` is `other`. */
  detail?: string | null;
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
  outcome: ModerationOutcome;
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
 * What a member is told about their own standing.
 *
 * A sanctioned member is told, and told when it ends. A restriction the member
 * cannot see is one they cannot appeal, and blueprint 10.4 asks for appeals.
 */
export interface OwnStandingResponse {
  sanctions: Sanction[];
}
