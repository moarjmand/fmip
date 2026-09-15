import { describe, expect, it } from 'vitest';
import { ELIGIBILITY_V1, eligibilityFor, type EligibilityFacts } from './internal/eligibility';

/**
 * The four measurable requirements (blueprint 9.4, `13-policy.md` §1, T-250).
 *
 * These were `points.spec.ts`'s until T-250 gave eligibility a conduct
 * requirement and a home of its own. The property worth keeping from there is
 * the one about Career Points: they cannot unlock this, and the check is that
 * the function has nowhere to put them.
 */
const CLEAN: EligibilityFacts = {
  rating: 75,
  settled_count: 60,
  email_verified: true,
  under_sanction: false,
  recently_sanctioned: false,
  last_sanctioned_at: null,
};

const facts = (over: Partial<EligibilityFacts> = {}): EligibilityFacts => ({ ...CLEAN, ...over });

describe('who qualifies as a contributor', () => {
  it('says yes when all four are met, and says so as `qualifies`', () => {
    const answer = eligibilityFor(facts());
    expect(answer.qualifies).toBe(true);
    expect(answer.shortfalls).toEqual([]);
    expect(answer.rules_version).toBe(ELIGIBILITY_V1.version);
  });

  it('names every unmet requirement at once, not the first one', () => {
    // A member told one thing to fix, who fixes it and is told a second, has
    // been given a queue rather than an answer.
    const answer = eligibilityFor(facts({ rating: 40, settled_count: 12, email_verified: false }));
    expect(answer.qualifies).toBe(false);
    expect(answer.shortfalls).toEqual([
      { requirement: 'email', message: 'verify your e-mail address' },
      { requirement: 'settled', message: 'settle at least 50 predictions (12 so far)' },
      { requirement: 'rating', message: 'reach a rating of 70 (currently 40)' },
    ]);
  });

  it('treats no rating as no rating, not as a bad one', () => {
    const answer = eligibilityFor(facts({ rating: null, settled_count: 0 }));
    expect(answer.rating).toBeNull();
    expect(answer.shortfalls.map((s) => s.message)).toEqual([
      'settle at least 50 predictions (none yet)',
      'reach a rating of 70',
    ]);
    // "(currently 0)" would have been a sentence about a member who has never
    // been rated at all (rule 3).
    expect(answer.shortfalls.some((s) => s.message.includes('currently'))).toBe(false);
  });

  it('accepts exactly the threshold, because 70 means 70', () => {
    expect(eligibilityFor(facts({ rating: 70, settled_count: 50 })).qualifies).toBe(true);
    expect(eligibilityFor(facts({ rating: 69.99 })).qualifies).toBe(false);
    expect(eligibilityFor(facts({ settled_count: 49 })).qualifies).toBe(false);
  });
});

describe('conduct, which is the requirement D-059 added', () => {
  it('refuses an active restriction, and says it is in force rather than naming conduct', () => {
    const answer = eligibilityFor(facts({ under_sanction: true }));
    expect(answer.qualifies).toBe(false);
    expect(answer.shortfalls).toEqual([
      { requirement: 'conduct', message: 'a moderation restriction is in force' },
    ]);
  });

  it('refuses a recent decision separately, and says which window', () => {
    const answer = eligibilityFor(facts({ recently_sanctioned: true }));
    expect(answer.shortfalls).toEqual([
      { requirement: 'conduct', message: 'no moderation decision in the last 90 days' },
    ]);
  });

  it('says one thing when both are true, because two would not be more useful', () => {
    // An active restriction always implies a decision; telling somebody both
    // would read as two separate obstacles when there is one.
    const answer = eligibilityFor(facts({ under_sanction: true, recently_sanctioned: true }));
    expect(answer.shortfalls).toHaveLength(1);
    expect(answer.shortfalls[0]?.message).toBe('a moderation restriction is in force');
  });

  it('lets an old decision pass, and still reports it', () => {
    const old = '2020-01-01T00:00:00.000Z';
    const answer = eligibilityFor(facts({ recently_sanctioned: false, last_sanctioned_at: old }));
    expect(answer.qualifies).toBe(true);
    // "A sanction from two years ago that was served and never repeated is not
    // a reason to refuse somebody for life" (`13-policy.md` §1) — and it is
    // still sent, so the answer can be explained rather than just given.
    expect(answer.last_sanctioned_at).toBe(old);
  });
});

describe('what eligibility is not', () => {
  it('has no field that says anybody may post', () => {
    const answer = eligibilityFor(facts());
    // The one structural guard in this file. `qualifies` means "may be
    // considered"; whether somebody may post is a question about a grant, and a
    // surface that found an `approved` here would stop asking.
    expect(Object.keys(answer).sort()).toEqual([
      'email_verified',
      'last_sanctioned_at',
      'qualifies',
      'rating',
      'rules_version',
      'settled_count',
      'shortfalls',
      'under_sanction',
    ]);
  });

  it('cannot be unlocked by Career Points: they are not an input at all', () => {
    // A million points and no rating is still not eligible, and the function has
    // no parameter through which points could arrive (blueprint 9.2).
    expect(eligibilityFor(facts({ rating: null, settled_count: 0 })).qualifies).toBe(false);
    expect(Object.keys(CLEAN)).not.toContain('points');
  });

  it('carries the thresholds it judged against, so an old answer stays explainable', () => {
    expect(ELIGIBILITY_V1).toEqual({
      version: 'privilege-eligibility@1.1.0',
      minRating: 70,
      minSettled: 50,
      conductWindowDays: 90,
    });
    // 1.1.0 rather than 1.0.0: the two thresholds are confirmed unchanged and
    // the conduct requirement is new, which changes the verdict for some people.
    const strict = { ...ELIGIBILITY_V1, minRating: 90, version: 'privilege-eligibility@9.9.9' };
    const answer = eligibilityFor(facts(), strict);
    expect(answer.qualifies).toBe(false);
    expect(answer.rules_version).toBe('privilege-eligibility@9.9.9');
  });
});
