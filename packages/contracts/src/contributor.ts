/**
 * Approval to post on a public match panel (blueprint 9.4 and 10.2, T-250).
 *
 * Two types that must never collapse into one. `ContributorEligibility` is what
 * the platform **computes**: four measurable requirements, and a list of what is
 * missing. `ContributorGrant` is what a person **decided**: an approver, a
 * reason, and the contributor rules the member accepted. Eligibility decides who
 * may be considered; only a grant lets anybody post.
 *
 * So there is no `eligible_and_approved` here, and no single boolean a surface
 * could read to mean either. A client that wants to know whether somebody may
 * post asks about the grant; a client showing a member their own progress asks
 * about eligibility. Conflating them is exactly the defect the task exists to
 * prevent, and a shared field would be the easiest way to reintroduce it.
 */

/** One unmet requirement, in the member's own terms. */
export interface EligibilityShortfall {
  /** Which of the four requirements (`13-policy.md` section 1). */
  requirement: 'rating' | 'settled' | 'email' | 'conduct';
  /** What to do about it, or why it cannot be done yet. */
  message: string;
}

/**
 * Blueprint 9.4's four measurable requirements, computed and never stored.
 *
 * Career Points are deliberately absent (blueprint 9.2): they cannot by
 * themselves unlock expert status, and the type gives no place to put them.
 */
export interface ContributorEligibility {
  /** Meets all four. Says nothing about whether anybody approved them. */
  qualifies: boolean;
  /** Empty exactly when `qualifies` is true. */
  shortfalls: EligibilityShortfall[];
  /** The thresholds these were judged against, so an answer can be explained. */
  rules_version: string;
  /**
   * The rating the judgement used, or null when the member has settled nothing.
   * Null is not zero: a member with no rating has not been rated badly.
   */
  rating: number | null;
  settled_count: number;
  email_verified: boolean;
  /** Under an active sanction of any scope, right now. */
  under_sanction: boolean;
  /**
   * ISO 8601 of the most recent `sanctioned` decision, or null for none ever.
   * Sent whatever its age, because a decision outside the window is still a
   * fact about a member and hiding it would make the answer unexplainable.
   */
  last_sanctioned_at: string | null;
}

/** What a grant currently is. Derived from its events, never stored. */
export type GrantStanding = 'active' | 'paused' | 'withdrawn';

/** One thing that happened to a grant after it was given. */
export interface GrantEvent {
  kind: 'paused' | 'resumed' | 'withdrawn';
  /** The moderator or administrator who did it. */
  actor: string;
  reason: string;
  /** ISO 8601. */
  at: string;
}

/**
 * A person's decision, with its history attached.
 *
 * `standing` is the answer a surface needs and `history` is why it is that
 * answer. Both are sent together because a paused contributor who is only told
 * "you cannot post" has been given an outcome without a reason, and blueprint
 * 9.4 promises they are told.
 */
export interface ContributorGrant {
  id: string;
  /** Who holds it. */
  username: string;
  standing: GrantStanding;
  /** Who approved it. */
  granted_by: string;
  /** Why they approved it. Never blank. */
  reason: string;
  /** ISO 8601. */
  granted_at: string;
  /** Which contributor rules the member accepted, e.g. `contributor-rules@1.0.0`. */
  rules_version: string;
  /** ISO 8601, when they accepted them. */
  accepted_at: string;
  /** Oldest first. Empty for a grant nobody has touched since. */
  history: GrantEvent[];
}

/**
 * `GET /me/contributor`, and the member's own view of both halves.
 *
 * `grant` is null for somebody who has never been approved, which is a
 * different state from a withdrawn grant and must not render the same way: one
 * has never been considered, the other was approved and then stopped, and only
 * the second is owed an explanation.
 */
export interface ContributorStatusResponse {
  username: string;
  eligibility: ContributorEligibility;
  grant: ContributorGrant | null;
}

/** `POST /admin/contributors`. The approving act (blueprint 9.4). */
export interface GrantContributorRequest {
  username: string;
  /** Recorded on the grant and readable afterwards; required. */
  reason: string;
  /** The version of the contributor rules the member accepted. */
  rules_version: string;
}

/** `POST /admin/contributors/:username/pause` and `/resume` and `/withdraw`. */
export interface GrantEventRequest {
  reason: string;
}

/** What an administrator sees when deciding (T-250). */
export interface ContributorCandidate {
  username: string;
  eligibility: ContributorEligibility;
  /** Null when they have never held one. */
  grant: ContributorGrant | null;
}

/** `GET /admin/contributors`. */
export interface ContributorListResponse {
  /** ISO 8601, when this page was assembled. */
  generated_at: string;
  entries: ContributorCandidate[];
}
