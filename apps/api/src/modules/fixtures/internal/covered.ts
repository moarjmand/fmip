import type {
  CoverageState,
  Covered,
  FixtureStatus,
  MatchAbsence,
  MatchCentre,
} from '@fmip/contracts';

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

/**
 * How far ahead of kick-off the line-ups job starts asking who will miss a
 * match: the ingestion boundary's `AVAILABILITY_WINDOW_HOURS` (T-103), which
 * this read side does not import; a match further away is "not yet" (T-1364).
 */
export const ABSENCES_ASKED_FROM_HOURS = 72;

/** What the store holds about one match's absences (T-103, T-1364). */
export interface StoredAbsences {
  rows: MatchAbsence[];
  /** When the provider was last asked about this match; `null` if never. */
  askedAt: string | null;
  /** The provider says it does not report absences for this match's season. */
  notCovered: boolean;
}

/**
 * The match centre's absence list (T-103, T-1364). Pure.
 *
 *   someone listed       → `available`, the list.
 *   season not covered   → `not_supplied`, `not_covered`: an empty answer from
 *                          a provider that does not report absences there is
 *                          not "nobody is missing" (rule 3).
 *   asked                → `available` and empty: nobody, dated by the ask.
 *   scheduled, > 72 h    → `not_supplied`, `not_yet`: asked from ~3 days out.
 *   otherwise            → `not_supplied`, `not_asked`.
 */
export function absencesCovered(
  stored: StoredAbsences,
  match: { status: FixtureStatus; kickoffAt: string },
  now: Date,
): MatchCentre['availability'] {
  if (stored.rows.length > 0 || (stored.askedAt !== null && !stored.notCovered)) {
    return { coverage: 'available', last_updated_at: stored.askedAt, data: stored.rows, gap: null };
  }
  const gap = stored.notCovered
    ? 'not_covered'
    : match.status === 'scheduled' &&
        new Date(match.kickoffAt).getTime() - now.getTime() >
          ABSENCES_ASKED_FROM_HOURS * 60 * 60 * 1000
      ? 'not_yet'
      : 'not_asked';
  return { coverage: 'not_supplied', last_updated_at: null, data: null, gap };
}
