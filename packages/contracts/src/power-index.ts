/**
 * The Power Index (blueprint 6.1, T-110).
 *
 * The explanatory number beside each team in a match centre: 0 to 100, with the
 * components it was built from. Two properties are contractual rather than
 * incidental, because the blueprint asks for both.
 *
 * **It is not a sum of arbitrary points.** Every component is a position in a
 * distribution — where this team sits among the teams it is being compared with
 * — so 0.8 means "stronger than eight in ten of them", which is a claim that can
 * be checked against history. The weights below are the blueprint's, and T-113
 * either validates them or replaces them in a new formula version.
 *
 * **A missing component is missing, not neutral.** Nothing supplies line-up
 * quality or managerial stability on the free data of D-049, and filling them in
 * with 0.5 would be inventing a value (rule 3). Instead the component is
 * `not_supplied`, its weight is redistributed across the components that did
 * arrive, and the share of weight actually covered is published beside the
 * number as `completeness`. A reader who sees 78 at 75% completeness knows what
 * they are looking at; a reader who sees 78 alone does not.
 */

import type { CoverageState } from './coverage';

export const POWER_INDEX_COMPONENTS = [
  'underlying_strength',
  'recent_form',
  'lineup_quality',
  'venue',
  'rest_and_congestion',
  'competition_context',
  'stability',
] as const;

export type PowerIndexComponent = (typeof POWER_INDEX_COMPONENTS)[number];

/** The blueprint's weights (6.1). They sum to 1. */
export const POWER_INDEX_WEIGHTS: Readonly<Record<PowerIndexComponent, number>> = {
  underlying_strength: 0.35,
  recent_form: 0.2,
  lineup_quality: 0.2,
  venue: 0.1,
  rest_and_congestion: 0.05,
  competition_context: 0.05,
  stability: 0.05,
};

/** What each component means, in the words the panel shows. */
export const POWER_INDEX_LABELS: Readonly<Record<PowerIndexComponent, string>> = {
  underlying_strength: 'Underlying team strength',
  recent_form: 'Recent opponent-adjusted performance',
  lineup_quality: 'Expected or confirmed line-up quality',
  venue: 'Venue effect',
  rest_and_congestion: 'Rest, travel and schedule',
  competition_context: 'Competition context',
  stability: 'Managerial and team stability',
};

export interface PowerIndexComponentValue {
  key: PowerIndexComponent;
  /** The weight this component carried in the published formula. */
  weight: number;
  /** Position in the distribution, `0`–`1`. `null` exactly when not supplied. */
  value: number | null;
  /** `available` or `limited` when supplied; `not_supplied` when absent. */
  state: CoverageState;
  /** Why it is absent, or what it was computed from. */
  note: string | null;
}

export interface PowerIndex {
  team: { id: string; name: string };
  /** 0–100, rounded to one decimal. */
  value: number;
  /**
   * Share of the formula's weight actually supplied, `0`–`1`. Below 1 means
   * components were missing and their weight was redistributed. Always shown.
   */
  completeness: number;
  formula_version: string;
  computed_at: string;
  components: PowerIndexComponentValue[];
  /**
   * The components that moved this index furthest from the middle, strongest
   * first — what the blueprint calls the leading factors. Never more than
   * three, and only ones that were actually supplied.
   */
  leading: PowerIndexComponent[];
}

/** Both sides, as a match centre shows them. */
export interface PowerIndexPair {
  home: PowerIndex;
  away: PowerIndex;
}

/**
 * `GET /fixtures/:id/power-index`.
 *
 * One of the two fields is always null. There is an index for both sides or
 * there is none: an index for one team beside a blank for the other invites a
 * comparison it cannot support, so the absence is stated for the pair, with the
 * reason a reader can act on.
 */
export interface PowerIndexResponse {
  index: PowerIndexPair | null;
  unavailable_reason: string | null;
}
