/**
 * Coverage states.
 *
 * Not every competition has the same data depth. Rule 3 in `CLAUDE.md`: when
 * data is missing the API says so explicitly. It never returns an empty module
 * that looks populated, and never invents a value.
 */
export const COVERAGE_STATES = ['available', 'limited', 'not_supplied', 'delayed'] as const;

export type CoverageState = (typeof COVERAGE_STATES)[number];

/**
 * Every module payload the API returns is wrapped in this.
 *
 * `data` is `null` for every state except `available` and `limited`, and
 * `last_updated_at` is `null` only when nothing has ever been fetched. Rule 4:
 * a live surface always carries the time it was last updated, so the UI can say
 * "stale" rather than presenting old numbers as current.
 */
export interface Covered<T> {
  coverage: CoverageState;
  last_updated_at: string | null;
  data: T | null;
}

/**
 * Narrows a payload to one that actually carries data.
 *
 * `limited` still carries data — it means some fields are missing, not all of
 * them — so it passes. `delayed` carries data that is known to be behind, which
 * the caller must label rather than hide, so it passes too and the caller reads
 * `coverage` to decide what to show.
 */
export function hasData<T>(payload: Covered<T>): payload is Covered<T> & { data: T } {
  return payload.data !== null && payload.coverage !== 'not_supplied';
}

export function isCoverageState(value: string): value is CoverageState {
  return (COVERAGE_STATES as readonly string[]).includes(value);
}
