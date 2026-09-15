import type { ContributorEligibility, EligibilityShortfall } from '@fmip/contracts';

/**
 * Who qualifies to be considered as a contributor (blueprint 9.4, T-250).
 *
 * Blueprint 9.4 names four measurable requirements and a fifth that is a
 * person's decision. **These are the four, and none of them grants anything.**
 * The word this file is careful about is `qualifies` rather than `approved`:
 * whether anybody may post is a question about `contributor_grant`, and nothing
 * here can answer it.
 *
 * Career Points are deliberately not an input (blueprint 9.2, T-054: they
 * "cannot by themselves unlock expert status"). The type says so — this
 * function cannot even see them.
 *
 * **The numbers live here and nowhere else.** `13-policy.md` §1 fixes them and
 * this is the constant it points at, including the ninety-day conduct window.
 * The database deliberately holds none of them: `contributor_eligibility_input`
 * carries facts, and a copy of `70` in SQL would be a second place to change a
 * number nobody would find the day the two disagreed.
 */
export interface EligibilityRules {
  version: string;
  minRating: number;
  minSettled: number;
  /**
   * How far back a `sanctioned` decision still counts. Applied against the
   * **database** clock (the store passes it into the query) rather than this
   * process's, so that one clock decides and a container with a drifting one
   * cannot make a member eligible here and ineligible in the next request.
   */
  conductWindowDays: number;
}

/**
 * `1.1.0` rather than `1.0.0`: the thresholds are unchanged and confirmed, and
 * the conduct requirement is new (D-059). Adding a requirement changes what the
 * function decides about some members, so it changes the version — the answer a
 * member was given last month has to stay explainable.
 */
export const ELIGIBILITY_V1: EligibilityRules = {
  version: 'privilege-eligibility@1.1.0',
  minRating: 70,
  minSettled: 50,
  conductWindowDays: 90,
};

/**
 * What the four requirements are judged from. Every field is a fact somebody
 * else established: the rating comes from a snapshot, the conduct answers from
 * the moderation tables, and none of them is computed here.
 */
export interface EligibilityFacts {
  /** Null when the member has settled nothing. Not zero: they were not rated badly. */
  rating: number | null;
  settled_count: number;
  email_verified: boolean;
  /** Under an active sanction of any scope, right now, by the database clock. */
  under_sanction: boolean;
  /** A `sanctioned` decision inside `conductWindowDays`, by the database clock. */
  recently_sanctioned: boolean;
  /** The newest one whatever its age, so an answer can be explained. */
  last_sanctioned_at: string | null;
}

export function eligibilityFor(
  facts: EligibilityFacts,
  rules: EligibilityRules = ELIGIBILITY_V1,
): ContributorEligibility {
  const shortfalls: EligibilityShortfall[] = [];

  if (!facts.email_verified) {
    shortfalls.push({ requirement: 'email', message: 'verify your e-mail address' });
  }

  if (facts.rating === null) {
    shortfalls.push({
      requirement: 'settled',
      message: `settle at least ${rules.minSettled} predictions (none yet)`,
    });
    shortfalls.push({
      requirement: 'rating',
      message: `reach a rating of ${rules.minRating}`,
    });
  } else {
    if (facts.settled_count < rules.minSettled) {
      shortfalls.push({
        requirement: 'settled',
        message: `settle at least ${rules.minSettled} predictions (${facts.settled_count} so far)`,
      });
    }
    if (facts.rating < rules.minRating) {
      shortfalls.push({
        requirement: 'rating',
        message: `reach a rating of ${rules.minRating} (currently ${facts.rating})`,
      });
    }
  }

  // Two different facts, and they are not merged. An active restriction is
  // something a member can see the end of; a decision inside the window is a
  // record that will age out on a date. Telling somebody "your conduct" for
  // either would leave them unable to tell which they were being refused for,
  // or when it stops (rule 3, aimed at the person it is about).
  if (facts.under_sanction) {
    shortfalls.push({
      requirement: 'conduct',
      message: 'a moderation restriction is in force',
    });
  } else if (facts.recently_sanctioned) {
    shortfalls.push({
      requirement: 'conduct',
      message: `no moderation decision in the last ${rules.conductWindowDays} days`,
    });
  }

  return {
    qualifies: shortfalls.length === 0,
    shortfalls,
    rules_version: rules.version,
    rating: facts.rating,
    settled_count: facts.settled_count,
    email_verified: facts.email_verified,
    under_sanction: facts.under_sanction,
    last_sanctioned_at: facts.last_sanctioned_at,
  };
}
