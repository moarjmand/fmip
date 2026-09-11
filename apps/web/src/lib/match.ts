import type { CoverageState, Covered, MatchIncident, MatchStatMetric } from '@fmip/contracts';

/**
 * Pure helpers for the match centre page (T-034): labels for incidents,
 * statistics and coverage states, and the list of blueprint 4.2 modules the
 * platform does not have yet, which the page names rather than hides.
 */

export const INCIDENT_LABEL: Record<MatchIncident['kind'], string> = {
  goal: 'Goal',
  own_goal: 'Own goal',
  penalty_goal: 'Penalty',
  penalty_missed: 'Penalty missed',
  yellow_card: 'Yellow card',
  second_yellow_card: 'Second yellow',
  red_card: 'Red card',
  substitution: 'Substitution',
  var: 'VAR',
};

export const STAT_LABEL: Record<MatchStatMetric, string> = {
  possession_pct: 'Possession',
  shots: 'Shots',
  shots_on_target: 'Shots on target',
  shots_off_target: 'Shots off target',
  blocked_shots: 'Blocked shots',
  corners: 'Corners',
  offsides: 'Offsides',
  fouls: 'Fouls',
  yellow_cards: 'Yellow cards',
  red_cards: 'Red cards',
  passes: 'Passes',
  passes_accurate: 'Accurate passes',
  pass_accuracy_pct: 'Pass accuracy',
  saves: 'Saves',
  expected_goals: 'Expected goals (xG)',
};

export const COVERAGE_LABEL: Record<CoverageState, string> = {
  available: 'available',
  limited: 'limited',
  not_supplied: 'not supplied',
  delayed: 'data delayed',
};

/** "45+2′" or "67′". */
export function minuteLabel(minute: number, addedTime: number | null): string {
  return addedTime !== null && addedTime > 0 ? `${minute}+${addedTime}′` : `${minute}′`;
}

/** A statistic value as shown: percentages with the sign, xG with two decimals. */
export function statValue(metric: MatchStatMetric, value: number | null): string {
  if (value === null) return '–';
  if (metric.endsWith('_pct')) return `${value}%`;
  if (metric === 'expected_goals') return value.toFixed(2);
  return String(value);
}

/**
 * What the module header says beside its name. A module with data still
 * carries its state (limited, delayed) so the reader knows what they are
 * looking at; one without data says why there is nothing.
 */
export function moduleState<T>(module: Covered<T>): string {
  return COVERAGE_LABEL[module.coverage];
}

/** Blueprint 4.2 modules that are not built yet, named on the page (rule 3). */
export const NOT_YET = [
  ["Founder's analysis", 'unsupported'],
  ['Community forecast', 'unsupported'],
  ['Availability', 'unsupported'],
  ['Key players', 'unsupported'],
  ['Discussion', 'unsupported'],
  ['Watch and highlights', 'unsupported'],
  ['Related news', 'unsupported'],
] as const;
