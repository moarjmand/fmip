import { describe, expect, it } from 'vitest';
import {
  ADMIN_ONLY_NOTIFICATION_KINDS,
  NOTIFICATION_CATEGORY_OF,
  NOTIFICATION_DEFAULTS,
  QUIET_HOURS_EXEMPT,
  notificationLine,
} from '@fmip/contracts';
import { eligibilityNotices, eligibleKey } from './internal/eligibility-notice';

/** T-833, D-100: administrators hear of a member newly qualifying, once per transition. */
describe('eligibilityNotices', () => {
  const admins = ['admin-1', 'admin-2'];

  it('tells every administrator on a transition to qualifying, keyed by the transition', () => {
    const notices = eligibilityNotices('m', { qualifies: true, timesQualified: 1 }, false, admins);
    expect(notices).toEqual([
      {
        userId: 'admin-1',
        kind: 'contributor_eligible',
        subjectType: 'member',
        subjectId: 'm',
        dedupeKey: 'contributor_eligible:m:1',
      },
      {
        userId: 'admin-2',
        kind: 'contributor_eligible',
        subjectType: 'member',
        subjectId: 'm',
        dedupeKey: 'contributor_eligible:m:1',
      },
    ]);
  });

  it('says nothing when the verdict did not change, or changed to not qualifying', () => {
    expect(eligibilityNotices('m', null, false, admins)).toEqual([]);
    expect(eligibilityNotices('m', { qualifies: false, timesQualified: 1 }, false, admins)).toEqual(
      [],
    );
  });

  it('says nothing about a member who already holds a grant', () => {
    expect(eligibilityNotices('m', { qualifies: true, timesQualified: 2 }, true, admins)).toEqual(
      [],
    );
  });

  it('does not tell an administrator about themselves', () => {
    const notices = eligibilityNotices('admin-1', { qualifies: true, timesQualified: 1 }, false, [
      'admin-1',
      'admin-2',
    ]);
    expect(notices.map((n) => n.userId)).toEqual(['admin-2']);
  });

  it('a second qualification is a second notice; a repeat of the first is the same one', () => {
    expect(eligibleKey('m', 2)).not.toBe(eligibleKey('m', 1));
    expect(eligibleKey('m', 1)).toBe(eligibleKey('m', 1));
  });
});

describe('the editorial kinds', () => {
  it('keeps the contributor queue for administrators, and quiet hours still hold it', () => {
    expect(ADMIN_ONLY_NOTIFICATION_KINDS).toContain('contributor_eligible');
    expect(QUIET_HOURS_EXEMPT).not.toContain('contributor_eligible');
    expect(NOTIFICATION_CATEGORY_OF.contributor_eligible).toBe('account');
  });

  it('is on by default, all three', () => {
    expect(NOTIFICATION_DEFAULTS.founder_analysis_published).toBe(true);
    expect(NOTIFICATION_DEFAULTS.analysis_reviewed).toBe(true);
    expect(NOTIFICATION_DEFAULTS.contributor_eligible).toBe(true);
  });

  it('reads a line without a name where the headline could not be resolved', () => {
    expect(notificationLine({ kind: 'contributor_eligible', source: null, headline: null })).toBe(
      'A member now meets the contributor requirements.',
    );
  });
});
