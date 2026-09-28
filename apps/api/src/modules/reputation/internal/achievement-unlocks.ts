import type { Achievement, AchievementKind } from '@fmip/contracts';

/**
 * Telling a member they earned an achievement (blueprint 12.2, T-946, D-117).
 *
 * **Once, the first time it is derived.** Achievements stay derived on read
 * (D-091); the reputation job, after each recompute, records the first moment
 * it saw each one in `achievement_unlocked`, and only a kind with no row yet
 * is new. A row is never removed by a recomputation, so an achievement that a
 * corrected settlement takes away and a later one gives back was told once
 * and is not told again -- what was told cannot be lost, and cannot be
 * repeated.
 *
 * **Only when it is news.** An achievement first derived more than
 * `TELL_WINDOW_MS` after the stored time that earned it is recorded without a
 * notification: that is every achievement earned before T-946 shipped, on the
 * job's first pass, and one the job reached late. Being told in October about
 * a first exact score from March is noise, not a notification.
 */
export const ACHIEVEMENT_TELL_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;

export interface AchievementUnlock {
  kind: AchievementKind;
  earnedAt: string;
  /** Whether the member is to be told. */
  tell: boolean;
}

/** The achievements not yet recorded for the member, each marked told or not. */
export function newUnlocks(
  earned: readonly Achievement[],
  recorded: ReadonlySet<AchievementKind>,
  now: Date,
  windowMs = ACHIEVEMENT_TELL_WINDOW_MS,
): AchievementUnlock[] {
  return earned
    .filter((a) => !recorded.has(a.kind))
    .map((a) => ({
      kind: a.kind,
      earnedAt: a.earned_at,
      tell: now.getTime() - Date.parse(a.earned_at) <= windowMs,
    }));
}

/** One notification per achievement per member, ever. */
export function unlockKey(userId: string, kind: AchievementKind): string {
  return `achievement_unlocked:${userId}:${kind}`;
}
