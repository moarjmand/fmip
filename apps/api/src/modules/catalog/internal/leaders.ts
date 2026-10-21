import type { Covered, PlayerSeasonMinutes } from '@fmip/contracts';
import { NO_LINEUPS } from './player-store';

/** Matches played, or null when no line-up (nor provider line) names the player (T-1441). */
export function appearancesOf(minutes: PlayerSeasonMinutes): number | null {
  return minutes.matches > 0 ? minutes.matches : null;
}

interface Ranked {
  person: { id: string; name: string };
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * The order of every leader table (T-1441, D-232): the figure, highest
 * first; ties by fewer appearances (the same figure in fewer matches is the
 * better return), a player whose appearances are not recorded after those
 * whose are; then by name, then id so the order never depends on the query.
 */
export function rankByFigure<T extends Ranked>(
  rows: readonly T[],
  figure: (row: T) => number,
  minutesOf: ReadonlyMap<string, PlayerSeasonMinutes>,
): T[] {
  const apps = (row: T): number => {
    const minutes = minutesOf.get(row.person.id);
    return (minutes === undefined ? null : appearancesOf(minutes)) ?? Number.POSITIVE_INFINITY;
  };
  return [...rows].sort(
    (a, b) =>
      figure(b) - figure(a) ||
      (apps(a) === apps(b) ? 0 : apps(a) < apps(b) ? -1 : 1) ||
      compareText(a.person.name, b.person.name) ||
      compareText(a.person.id, b.person.id),
  );
}

/**
 * The rows that can make a table of `limit` rows once ties are broken: those
 * whose figure reaches the `limit`-th highest, so every player tied at the
 * cut-off is considered, not the first few the query happened to return.
 */
export function candidatesForTop<T>(
  rows: readonly T[],
  figure: (row: T) => number,
  limit: number,
): T[] {
  if (rows.length <= limit) return [...rows];
  const sorted = [...rows].sort((a, b) => figure(b) - figure(a));
  const cut = figure(sorted[limit - 1]!);
  return sorted.filter((r) => figure(r) >= cut);
}

/**
 * A board counted from incidents is whole only if the incidents cover the
 * season's scores (T-1441): fewer goals recorded than the finished matches'
 * scores add up to means some match's incidents are not stored (yet), so the
 * module is at most `limited`.
 */
export function wholeOnlyIfRecorded<T>(
  module: Covered<T[]>,
  tally: { scoredGoals: number; recordedGoals: number },
): Covered<T[]> {
  return module.coverage === 'available' && tally.recordedGoals < tally.scoredGoals
    ? { ...module, coverage: 'limited' }
    : module;
}

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
 * null, only those whose record shows the floor (T-824). The rows arrive in
 * their table's order (`rankByFigure`), which is kept; the first `limit` that
 * pass are the answer. A scorer the record cannot judge
 * is counted in `unproven` rather than dropped silently. The boards beyond
 * goals (T-943) pass through the same rule in their own order.
 */
export function leadersWithMinutes<T extends { person: { id: string } }>(
  scorers: T[],
  minutesOf: ReadonlyMap<string, PlayerSeasonMinutes>,
  floor: number | null,
  limit: number,
): {
  leaders: (T & { minutes: PlayerSeasonMinutes; appearances: number | null })[];
  unproven: number;
} {
  const leaders: (T & { minutes: PlayerSeasonMinutes; appearances: number | null })[] = [];
  let unproven = 0;
  for (const scorer of scorers) {
    const minutes = minutesOf.get(scorer.person.id) ?? NO_LINEUPS;
    if (floor !== null) {
      const reached = reachesFloor(minutes, floor);
      if (reached === null) unproven += 1;
      if (reached !== true) continue;
    }
    if (leaders.length < limit)
      leaders.push({ ...scorer, minutes, appearances: appearancesOf(minutes) });
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
