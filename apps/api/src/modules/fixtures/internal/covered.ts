import type { CoverageState, Covered } from '@fmip/contracts';

/**
 * How stored rows and a season's declared coverage become one `Covered`
 * module (blueprint 4.3). Pure, tested on its own.
 *
 *   rows present → data, and the declared state unless it denies the data
 *                  exists, in which case `limited` (we have some, the profile
 *                  promised none: partial by definition).
 *   rows absent  → data null; `delayed` stays `delayed` (the provider is
 *                  behind), everything else is `not_supplied` for this
 *                  fixture, whatever the season promises.
 */
export function covered<T>(
  data: T | null,
  isEmpty: boolean,
  declared: CoverageState | null,
  lastUpdatedAt: string | null,
): Covered<T> {
  if (data === null || isEmpty) {
    return {
      coverage: declared === 'delayed' ? 'delayed' : 'not_supplied',
      last_updated_at: lastUpdatedAt,
      data: null,
    };
  }
  const coverage: CoverageState =
    declared === 'available' || declared === 'limited' || declared === 'delayed'
      ? declared
      : 'limited';
  return { coverage, last_updated_at: lastUpdatedAt, data };
}

/**
 * Derived modules (form, head-to-head) are computed from our own fixture
 * table, so their coverage is about how much history we hold: the full
 * window is `available`, a partial one `limited`, none `not_supplied`.
 */
export function derived<T>(items: T[], wanted: number, lastUpdatedAt: string | null): Covered<T[]> {
  if (items.length === 0) {
    return { coverage: 'not_supplied', last_updated_at: lastUpdatedAt, data: null };
  }
  return {
    coverage: items.length >= wanted ? 'available' : 'limited',
    last_updated_at: lastUpdatedAt,
    data: items,
  };
}
