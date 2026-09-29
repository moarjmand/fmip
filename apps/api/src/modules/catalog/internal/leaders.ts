import type { Covered, PlayerSeasonMinutes } from '@fmip/contracts';
import { NO_LINEUPS } from './player-store';

/**
 * Whether a season's minutes show a floor was reached (T-824): `true` when
 * the record proves it (an `available` total at or above it, or a `limited`
 * season whose supplied minutes alone reach it -- they are "at least"),
 * `false` when it proves the opposite (an `available` total below it), and
 * `null` when it cannot say (`limited` below the floor, or `not_supplied`).
 */
export function reachesFloor(minutes: PlayerSeasonMinutes, floor: number): boolean | null {
  if (minutes.coverage === 'available' && minutes.total !== null) return minutes.total >= floor;
  if (minutes.supplied_minutes >= floor && minutes.matches_with_minutes > 0) return true;
  return null;
}

/**
 * The competition's leaders with their minutes and, when `floor` is not
 * null, only those whose record shows the floor (T-824). The scorers arrive
 * in the standings boundary's order (goals, then name), which is kept; the
 * first `limit` that pass are the answer. A scorer the record cannot judge
 * is counted in `unproven` rather than dropped silently. The boards beyond
 * goals (T-943) pass through the same rule in their own order.
 */
export function leadersWithMinutes<T extends { person: { id: string } }>(
  scorers: T[],
  minutesOf: ReadonlyMap<string, PlayerSeasonMinutes>,
  floor: number | null,
  limit: number,
): { leaders: (T & { minutes: PlayerSeasonMinutes })[]; unproven: number } {
  const leaders: (T & { minutes: PlayerSeasonMinutes })[] = [];
  let unproven = 0;
  for (const scorer of scorers) {
    const minutes = minutesOf.get(scorer.person.id) ?? NO_LINEUPS;
    if (floor !== null) {
      const reached = reachesFloor(minutes, floor);
      if (reached === null) unproven += 1;
      if (reached !== true) continue;
    }
    if (leaders.length < limit) leaders.push({ ...scorer, minutes });
  }
  return { leaders, unproven };
}

/**
 * The leaders module under a floor: the scorers module's own state and
 * time, and `limited` when a scorer was left out for want of minutes -- the
 * list may be missing someone who did reach the floor. An empty list under a
 * floor is a list (nobody reached it), not an absence of data; without
 * scorers at all the module is what the standings boundary said.
 */
export function leadersModule<S, L>(
  scorers: Covered<S[]>,
  result: { leaders: L[]; unproven: number },
): Covered<L[]> {
  if (scorers.data === null) return { ...scorers, data: null };
  const coverage =
    result.unproven > 0 && scorers.coverage === 'available' ? 'limited' : scorers.coverage;
  return { coverage, last_updated_at: scorers.last_updated_at, data: result.leaders };
}
