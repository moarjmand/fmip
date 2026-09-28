/**
 * Telling administrators a member newly meets the contributor requirements
 * (blueprint 18.3, T-833, D-100).
 *
 * **A transition, not a state.** The reputation job recomputes a member many
 * times; `contributor_eligibility_state` keeps the last verdict, and only a
 * change from "does not qualify" (or never seen) to "qualifies" is a
 * transition. The store reports one as the number of times the member has
 * qualified, and that number is in the dedupe key, so a member who drops
 * below and qualifies again is announced again, once.
 *
 * **Nothing for a member a person already decided about.** Somebody who holds
 * a grant, in any standing, has had their review; announcing them again would
 * be a queue item with nothing left to decide.
 */

/** What the store saw: the new verdict when it changed, or null when it did not. */
export interface VerdictChange {
  qualifies: boolean;
  /** How many times this member has become eligible, this time included. */
  timesQualified: number;
}

export interface EligibilityNotice {
  userId: string;
  kind: 'contributor_eligible';
  subjectType: 'member';
  subjectId: string;
  dedupeKey: string;
}

export function eligibleKey(memberId: string, timesQualified: number): string {
  return `contributor_eligible:${memberId}:${String(timesQualified)}`;
}

/** One notice per administrator, other than the member themselves, on a transition to qualifying. */
export function eligibilityNotices(
  memberId: string,
  change: VerdictChange | null,
  holdsGrant: boolean,
  administrators: string[],
): EligibilityNotice[] {
  if (change === null || !change.qualifies || holdsGrant) return [];
  return administrators
    .filter((admin) => admin !== memberId)
    .map((admin) => ({
      userId: admin,
      kind: 'contributor_eligible' as const,
      subjectType: 'member' as const,
      subjectId: memberId,
      dedupeKey: eligibleKey(memberId, change.timesQualified),
    }));
}
