import type {
  CoverageState,
  Covered,
  MatchIncident,
  MatchPlayerStats,
  MatchStatMetric,
  PlayerMatchMetric,
} from '@fmip/contracts';

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

/**
 * The line a statistics table ends with when the provider sent statistics for
 * a match but no expected goals (T-102): the one metric a reader looks for by
 * name, said to be missing rather than left out of the table unremarked.
 * `null` when xG is there.
 */
export function xgNotice(metrics: readonly MatchStatMetric[]): string | null {
  return metrics.includes('expected_goals')
    ? null
    : 'Expected goals (xG): the provider did not supply them for this match.';
}

/** The per-player columns the match centre shows (T-101), in reading order. */
export const PLAYER_COLUMNS: readonly [PlayerMatchMetric, string][] = [
  ['minutes', 'Min'],
  ['rating', 'Rating'],
  ['goals', 'Goals'],
  ['assists', 'Assists'],
  ['shots', 'Shots'],
  ['key_passes', 'Key passes'],
  ['tackles', 'Tackles'],
];

/** One cell: the provider's rating to one decimal, a count as it is, `–` when not supplied. */
export function playerCell(player: MatchPlayerStats, metric: PlayerMatchMetric): string {
  const value = player.stats[metric];
  if (value === undefined) return '–';
  return metric === 'rating' ? value.toFixed(1) : String(value);
}

/** Said under every player table: the one number a reader may look for and will not find. */
export const PLAYER_XG_NOTICE =
  'Expected goals per player: not supplied by the provider for any match.';

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

/**
 * Blueprint 4.2 modules that are not built yet, named on the page (rule 3).
 * The list only ever gets shorter: the founder's analysis (T-132), the
 * community forecast (T-135), the discussion (T-251), Watch and highlights
 * (T-314) and related news (T-145) left it the day they reached the page.
 */
export const NOT_YET = [
  ['Availability', 'unsupported'],
  ['Key players', 'unsupported'],
] as const;
