import type {
  CoverageState,
  Covered,
  FixtureStatus,
  MatchAbsence,
  MatchCentre,
  MatchExpectedGoals,
  MatchPlayerExpected,
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

/**
 * How long after kick-off the box-score job asks about a finished match: the
 * highlights feed's window, which it shares (`FEED_WINDOW_HOURS` in the
 * viewing boundary, T-1432).
 */
export const EXPECTED_GOALS_WINDOW_HOURS = 51;

/** A match's stored expected goals from their one source, as the store read them. */
export interface StoredExpectedGoals {
  rows: MatchPlayerExpected[];
  /** When the source answered for this match; null when it has not been asked. */
  answeredAt: string | null;
  /** Players the source listed that are not mapped to ours yet. */
  unplaced: number;
  /** Whether the match's competition is mapped to the source at all. */
  sourceCovers: boolean;
}

/**
 * The expected-goals module (T-1432, D-224). Figures: `available`, or
 * `limited` when the source listed players we have not placed. None: asked
 * and answered without a figure is `not_supplied`; not asked yet, for a
 * finished match of a covered competition still inside the job's window, is
 * `delayed`; anything else is `not_supplied`. Never a table of zeros (rule 3).
 */
export function expectedGoalsCovered(
  stored: StoredExpectedGoals,
  match: { status: FixtureStatus; kickoffAt: string },
  now: Date,
): MatchExpectedGoals {
  const labelled = { source: 'highlightly' as const, unplaced: stored.unplaced };
  if (stored.rows.length > 0) {
    return {
      ...labelled,
      coverage: stored.unplaced > 0 ? 'limited' : 'available',
      last_updated_at: stored.answeredAt,
      data: stored.rows,
    };
  }
  const owed =
    stored.answeredAt === null &&
    stored.sourceCovers &&
    match.status === 'finished' &&
    now.getTime() - Date.parse(match.kickoffAt) <= EXPECTED_GOALS_WINDOW_HOURS * 3_600_000;
  return {
    ...labelled,
    coverage: owed ? 'delayed' : 'not_supplied',
    last_updated_at: stored.answeredAt,
    data: null,
  };
}
