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
 * The one state that cannot be derived from counts is `delayed`: "the data
 * arrives, late" is a statement about a provider's behaviour over time, not
 * about rows. It is set by hand in the admin area (T-070) and this computation
 * preserves it as long as the evidence does not contradict it.
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
