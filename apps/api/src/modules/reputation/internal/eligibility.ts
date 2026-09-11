import type { Rating } from '@fmip/contracts';

/**
 * Whether a member is eligible for high-rating privileges (blueprint 9.4):
 * rating above the threshold, enough settled predictions, verified contact
 * information. Conduct records arrive with moderation (E7/Phase 2).
 *
 * Career Points are deliberately not an input (blueprint 9.2, T-054: they
 * "cannot by themselves unlock expert status"). The type says so: this
 * function cannot even see them.
 */
export interface EligibilityRules {
  version: string;
  minRating: number;
  minSettled: number;
}

export const ELIGIBILITY_V1: EligibilityRules = {
  version: 'privilege-eligibility@1.0.0',
  minRating: 70,
  minSettled: 50,
};

export interface Eligibility {
  eligible: boolean;
  /** What is missing, in the member's words; empty when eligible. */
  reasons: string[];
  rules_version: string;
}

export function eligibilityFor(
  rating: Rating | null,
  emailVerified: boolean,
  rules: EligibilityRules = ELIGIBILITY_V1,
): Eligibility {
  const reasons: string[] = [];
  if (!emailVerified) reasons.push('verify your e-mail address');
  if (rating === null) {
    reasons.push(`settle at least ${rules.minSettled} predictions (none yet)`);
    reasons.push(`reach a rating of ${rules.minRating}`);
  } else {
    if (rating.settled_count < rules.minSettled) {
      reasons.push(
        `settle at least ${rules.minSettled} predictions (${rating.settled_count} so far)`,
      );
    }
    if (rating.rating < rules.minRating) {
      reasons.push(`reach a rating of ${rules.minRating} (currently ${rating.rating})`);
    }
  }
  return { eligible: reasons.length === 0, reasons, rules_version: rules.version };
}
