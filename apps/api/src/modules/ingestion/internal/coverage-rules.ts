/**
 * How evidence becomes a coverage state (T-027, blueprint 4.3).
 *
 * Pure, so the rules can be argued with in a test rather than inferred from
 * SQL. The evidence is always the same shape: of the fixtures that *could*
 * carry this module, how many actually do. That framing is what keeps rule 3
 * honest — the question is never "did the provider promise it" but "is it
 * there", and a module nothing supplied says `not_supplied` rather than
 * appearing as an empty list.
 *
 * `delayed` is "the data arrives, late": a statement about a provider's
 * behaviour over time, not about counts. It is set by hand in the admin area
 * (T-070), and this computation preserves it as long as the evidence does not
 * contradict it. For line-ups it is also measured (T-1824, D-418): when they
 * reach us after kick-off in most of a season's recent matches, the season
 * says `delayed`, never `available`.
 */

import type { CoverageModule, CoverageState } from '@fmip/contracts';

export const COVERAGE_MODULES: readonly CoverageModule[] = [
  'scores',
  'incidents',
  'lineups',
  'statistics',
  'standings',
  'availability',
  'advanced_statistics',
];

/** Of the fixtures that could carry this module, how many do. */
export interface Evidence {
  /** Fixtures far enough along that the module should exist by now. */
  expected: number;
  /** Of those, the ones that actually carry it. */
  present: number;
  /**
   * When it arrived, for a module the provider sends before kick-off (line-ups,
   * T-1824): of the season's latest `ARRIVAL_SAMPLE` finished matches that
   * carry it, and that we knew of before they kicked off, how many had it
   * first stored after kick-off. Absent for every other module.
   */
  arrival?: { measured: number; late: number };
}

/**
 * How many of a season's latest finished matches the line-ups' arrival is
 * measured on (T-1824, D-418): recent enough to follow a provider that changes,
 * enough that one late match does not turn a league `delayed`.
 */
export const ARRIVAL_SAMPLE = 20;

/**
 * Whether a module's data arrives late as a rule: more than half of the
 * measured matches had it only after kick-off (T-1824, D-418). The Persian
 * Gulf Pro League's line-ups were after kick-off in 20 of its last 20 matches
 * on 2026-11-13; the leagues the provider covers on time were at 0 to 8 of 20.
 */
export function arrivesLate(arrival: Evidence['arrival']): boolean {
  return arrival !== undefined && arrival.measured > 0 && arrival.late * 2 > arrival.measured;
}

export interface Computed {
  state: CoverageState;
  note: string;
}

/**
 * Nothing expected yet is not the same as nothing supplied, and saying
 * otherwise would put `not_supplied` on a season that simply has not kicked
 * off. A season with no finished matches gets the honest version of "we do not
 * know yet", which is `not_supplied` with a note that says why — the UI shows
 * the absence either way, and the note is what an admin reads.
 */
export function compute(
  module: CoverageModule,
  evidence: Evidence,
  declared: CoverageState | null,
): Computed {
  const { expected, present } = evidence;

  if (expected === 0) {
    return {
      state: 'not_supplied',
      note: `No fixture in this season has reached the point where ${module} would exist.`,
    };
  }

  if (present === 0) {
    // A provider that is merely late still delivers, so an admin's `delayed`
    // survives an empty count; anything else is an absence.
    return declared === 'delayed'
      ? { state: 'delayed', note: `Nothing has arrived yet for ${expected} fixtures.` }
      : {
          state: 'not_supplied',
          note: `No ${module} for any of the ${expected} fixtures that should have them.`,
        };
  }

  // Data that is there but arrives after kick-off as a rule (T-1824, D-418):
  // `available` would promise line-ups before the match that never come
  // then, so the season says `delayed`, with both counts.
  const arrival = evidence.arrival;
  if (arrival !== undefined && arrivesLate(arrival)) {
    const { measured, late } = arrival;
    return {
      state: 'delayed',
      note:
        `${present} of ${expected} fixtures have ${module}; ` +
        `${late} of the last ${measured} had them only after kick-off.`,
    };
  }

  if (present >= expected) {
    return {
      state: 'available',
      note: `All ${expected} fixtures that should have ${module} have them.`,
    };
  }

  return {
    state: 'limited',
    note: `${present} of ${expected} fixtures have ${module}.`,
  };
}
