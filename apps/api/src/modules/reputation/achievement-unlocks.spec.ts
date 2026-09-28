import { describe, expect, it } from 'vitest';
import type { Achievement } from '@fmip/contracts';
import { notificationLine, notificationPath } from '@fmip/contracts';
import { ACHIEVEMENT_TELL_WINDOW_MS, newUnlocks, unlockKey } from './internal/achievement-unlocks';

/** Which achievements are new, and which of those are news (T-946, D-117). */
describe('achievement unlocks', () => {
  const now = new Date('2026-10-10T12:00:00.000Z');
  const at = (hoursAgo: number): string =>
    new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
  const earned: Achievement[] = [
    { kind: 'first_settled', earned_at: at(24 * 200), round: null },
    { kind: 'settled_10', earned_at: at(2), round: null },
    { kind: 'first_exact_score', earned_at: at(1), round: null },
  ];

  it('is only what has no record yet', () => {
    expect(newUnlocks(earned, new Set(['first_settled', 'first_exact_score']), now)).toEqual([
      { kind: 'settled_10', earnedAt: at(2), tell: true },
    ]);
    expect(newUnlocks(earned, new Set(earned.map((a) => a.kind)), now)).toEqual([]);
  });

  it('records one earned long ago without telling', () => {
    const unlocks = newUnlocks(earned, new Set(), now);
    expect(unlocks.map((u) => [u.kind, u.tell])).toEqual([
      ['first_settled', false],
      ['settled_10', true],
      ['first_exact_score', true],
    ]);
  });

  it('tells up to the window and not a moment after', () => {
    const edge = (ms: number): Achievement[] => [
      { kind: 'streak_5', earned_at: new Date(now.getTime() - ms).toISOString(), round: null },
    ];
    expect(newUnlocks(edge(ACHIEVEMENT_TELL_WINDOW_MS), new Set(), now)[0]?.tell).toBe(true);
    expect(newUnlocks(edge(ACHIEVEMENT_TELL_WINDOW_MS + 1), new Set(), now)[0]?.tell).toBe(false);
  });

  it('is keyed once per member and kind, and opens the profile at the list', () => {
    expect(unlockKey('u1', 'streak_5')).toBe('achievement_unlocked:u1:streak_5');
    expect(unlockKey('u1', 'streak_5')).not.toBe(unlockKey('u1', 'streak_10'));
    const notification = {
      kind: 'achievement_unlocked' as const,
      subject_type: 'member' as const,
      subject_id: 'u1',
      subject_label: 'ana',
      source: null,
    };
    expect(notificationPath('en', notification)).toBe('/en/u/ana#achievements');
    expect(notificationLine(notification)).toBe('You earned an achievement.');
  });
});
