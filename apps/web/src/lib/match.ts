import type { MatchIncident, MatchStatMetric } from '@fmip/contracts';
import { formatNumber, intlLocale } from '@/i18n/format';
import type { MessageKey } from '@/i18n/messages';
import { formatFixed, formatMinute } from '@/lib/words';

/**
 * Pure helpers for the match centre page (T-034): the catalogue keys for
 * incidents and statistics, minutes and statistic values in the reader's
 * digits (T-1309), and the list of blueprint 4.2 modules the platform does
 * not have yet, which the page names rather than hides.
 *
 * No catalogue import (the `MessageKey` import is a type), so the live match
 * centre's client component can use it; a server caller turns a key into
 * words with `t`, a client one with the words its page resolved.
 */

/** An incident's name, as a catalogue key. */
export const INCIDENT_KEY = {
  goal: 'matchCentre.incident.goal',
  own_goal: 'matchCentre.incident.ownGoal',
  penalty_goal: 'matchCentre.incident.penaltyGoal',
  penalty_missed: 'matchCentre.incident.penaltyMissed',
  yellow_card: 'matchCentre.incident.yellowCard',
  second_yellow_card: 'matchCentre.incident.secondYellow',
  red_card: 'matchCentre.incident.redCard',
  substitution: 'matchCentre.incident.substitution',
  var: 'matchCentre.incident.var',
} as const satisfies Record<MatchIncident['kind'], MessageKey>;

/** A team statistic's name, as a catalogue key. */
export const STAT_KEY = {
  possession_pct: 'matchCentre.stat.possession',
  shots: 'matchCentre.stat.shots',
  shots_on_target: 'matchCentre.stat.shotsOnTarget',
  shots_off_target: 'matchCentre.stat.shotsOffTarget',
  blocked_shots: 'matchCentre.stat.blockedShots',
  corners: 'matchCentre.stat.corners',
  offsides: 'matchCentre.stat.offsides',
  fouls: 'matchCentre.stat.fouls',
  yellow_cards: 'matchCentre.stat.yellowCards',
  red_cards: 'matchCentre.stat.redCards',
  passes: 'matchCentre.stat.passes',
  passes_accurate: 'matchCentre.stat.passesAccurate',
  pass_accuracy_pct: 'matchCentre.stat.passAccuracy',
  saves: 'matchCentre.stat.saves',
  expected_goals: 'matchCentre.stat.expectedGoals',
} as const satisfies Record<MatchStatMetric, MessageKey>;

/** "45+2′" or "67′", in the locale's digits. */
export function minuteLabel(minute: number, addedTime: number | null, locale = 'en'): string {
  return formatMinute(locale, minute, addedTime);
}

/** A statistic as shown, in the locale's digits: percentages with the sign, xG to two places. */
export function statValue(metric: MatchStatMetric, value: number | null, locale = 'en'): string {
  if (value === null) return '–';
  if (metric.endsWith('_pct')) {
    return new Intl.NumberFormat(intlLocale(locale), {
      style: 'percent',
      maximumFractionDigits: 2,
    }).format(value / 100);
  }
  if (metric === 'expected_goals') return formatFixed(locale, value, 2);
  return formatNumber(locale, value);
}

/**
 * Blueprint 4.2 modules that are not built yet, named on the page (rule 3).
 * The list only ever gets shorter: the founder's analysis (T-132), the
 * community forecast (T-135), the discussion (T-251), Watch and highlights
 * (T-314), related news (T-145) and the key players (T-841) left it the day
 * they reached the page. Empty now, and the page then leaves the list out.
 */
export const NOT_YET: readonly (readonly [name: string, why: string])[] = [];
