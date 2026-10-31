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

/**
 * What an incident adds to its kind, as a catalogue key (T-1378). The API
 * carries our code, never the provider's text; a value this page does not
 * know (a newer API) has no key and is left out, so the kind alone is shown.
 */
export const INCIDENT_DETAIL_KEY = {
  goal_cancelled: 'matchCentre.incidentDetail.goalCancelled',
  goal_confirmed: 'matchCentre.incidentDetail.goalConfirmed',
  penalty_awarded: 'matchCentre.incidentDetail.penaltyAwarded',
  penalty_cancelled: 'matchCentre.incidentDetail.penaltyCancelled',
  penalty_confirmed: 'matchCentre.incidentDetail.penaltyConfirmed',
  card_upgraded: 'matchCentre.incidentDetail.cardUpgraded',
  card_cancelled: 'matchCentre.incidentDetail.cardCancelled',
} as const satisfies Record<NonNullable<MatchIncident['detail']>, MessageKey>;

/** The catalogue key for an incident's detail, or `null` for none or one we do not know. */
export function incidentDetailKey(
  detail: MatchIncident['detail'],
): (typeof INCIDENT_DETAIL_KEY)[keyof typeof INCIDENT_DETAIL_KEY] | null {
  return detail !== null && Object.hasOwn(INCIDENT_DETAIL_KEY, detail)
    ? INCIDENT_DETAIL_KEY[detail]
    : null;
}

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

/**
 * Where a penalty shoot-out starts among a match's incidents in match order,
 * or `null` (T-1477). The feed records each kick as a penalty scored or
 * missed at a minute past the end of play (91′, 120+3′), so a plain list
 * showed a shoot-out as penalties in added time. The kicks are the trailing
 * run of penalty incidents whose scored kicks, per side, are exactly the
 * shoot-out's score: the longest such run, so a miss that opens the shoot-out
 * is kept in it.
 *
 * The feed can leave a kick out (Manresa v Sant Andreu, 2026-10-27: 1-4 on
 * penalties, one Manresa kick unrecorded), so no run adds up. Then, given the
 * score after play (T-1666), the kicks are the trailing penalties recorded at
 * the last kick's minute (the feed files every kick at one minute, 120+1,
 * 120+2, ...) after which the goals of play add up to that score, and whose
 * scored kicks are no more than the shoot-out's per side and miss at most one
 * of its goals. With no shoot-out
 * score, or neither reading, the list is left as recorded rather than
 * guessed at (rule 3).
 *
 * Since T-1673 (D-322) the API marks the kicks (`in_shootout`), from the
 * feed or read once from the shoot-out score: where any incident is marked,
 * the kicks are the trailing run of marked ones, with or without a shoot-out
 * score yet (a shoot-out being played). The readings above are for a list
 * with no mark (an older API, a feed without one), and a third after them
 * (D-322): the provider's own numbering of the kicks, 120+1, 120+2, ...
 * (`numberedShootoutStart`).
 */
export function shootoutStart(
  incidents: readonly ShootoutIncident[],
  penalties: { home: number; away: number } | null,
  afterPlay: { home: number; away: number } | null = null,
): number | null {
  if (incidents.some((i) => i.in_shootout === true)) {
    let marked = incidents.length;
    while (marked > 0 && incidents[marked - 1]!.in_shootout === true) marked -= 1;
    return marked < incidents.length ? marked : null;
  }
  if (penalties === null || penalties.home + penalties.away === 0) return null;
  let start = incidents.length;
  while (start > 0 && isKick(incidents[start - 1]!.kind)) start -= 1;
  for (let from = start; from < incidents.length; from += 1) {
    const scored = scoredKicks(incidents.slice(from));
    if (scored.home === penalties.home && scored.away === penalties.away) return from;
    // A shorter run only scores fewer: none further on can add up.
    if (scored.home < penalties.home || scored.away < penalties.away) break;
  }
  const short =
    afterPlay === null ? null : shortShootoutStart(incidents, start, penalties, afterPlay);
  return short ?? numberedShootoutStart(incidents, start, penalties);
}

/** What `shootoutStart` reads of an incident; the match centre's carry all of it. */
interface ShootoutIncident {
  kind: string;
  side: 'home' | 'away' | null;
  minute?: number;
  added_time?: number | null;
  /** The incident's place in the feed's list; the score cards carry none. */
  sequence?: number;
  in_shootout?: boolean;
}

/**
 * The provider's numbering of the kicks (D-322, as the migration's third
 * reading): the kicks start at the trailing run's last penalty numbered 1
 * (`added_time` 1) at the last incident's minute, the rows before it staying
 * play (an in-play penalty at 120+1 followed by kicks restarting at 120+1).
 * Every kick from there is at that minute; the numbers go up by one, or by
 * two where `sequence` also skips one place (a kick the feed listed and we
 * did not store; without `sequence`, never); two kicks at least; the scored
 * kicks pass the shoot-out score on neither side.
 */
function numberedShootoutStart(
  incidents: readonly ShootoutIncident[],
  start: number,
  penalties: { home: number; away: number },
): number | null {
  const last = incidents.at(-1)?.minute;
  if (last === undefined) return null;
  let from = -1;
  for (let at = incidents.length - 1; at >= start; at -= 1) {
    if (incidents[at]!.added_time === 1 && incidents[at]!.minute === last) {
      from = at;
      break;
    }
  }
  if (from < 0 || incidents.length - from < 2) return null;
  for (let at = from + 1; at < incidents.length; at += 1) {
    const kick = incidents[at]!;
    const before = incidents[at - 1]!;
    if (kick.minute !== last || kick.added_time == null || before.added_time == null) return null;
    const step = kick.added_time - before.added_time;
    const skipped =
      kick.sequence !== undefined && before.sequence !== undefined
        ? kick.sequence - before.sequence
        : null;
    if (step !== 1 && !(step === 2 && skipped === 2)) return null;
  }
  const scored = scoredKicks(incidents.slice(from));
  return scored.home <= penalties.home && scored.away <= penalties.away ? from : null;
}

function isKick(kind: string): boolean {
  return kind === 'penalty_goal' || kind === 'penalty_missed';
}

function scoredKicks(kicks: readonly { kind: string; side: 'home' | 'away' | null }[]): {
  home: number;
  away: number;
} {
  let home = 0;
  let away = 0;
  for (const kick of kicks) {
    if (kick.kind !== 'penalty_goal') continue;
    if (kick.side === 'home') home += 1;
    else if (kick.side === 'away') away += 1;
  }
  return { home, away };
}

/** The reading of a shoot-out with a kick missing from the feed (T-1666). */
function shortShootoutStart(
  incidents: readonly { kind: string; side: 'home' | 'away' | null; minute?: number }[],
  start: number,
  penalties: { home: number; away: number },
  afterPlay: { home: number; away: number },
): number | null {
  const last = incidents.at(-1)?.minute;
  if (start === incidents.length || last === undefined) return null;
  let from = start;
  while (from < incidents.length && incidents[from]!.minute !== last) from += 1;
  // An own goal is filed under either side by the feeds, so play is counted
  // as a total, not per side.
  const wanted = afterPlay.home + afterPlay.away;
  let played = incidents
    .slice(0, from)
    .filter((i) => i.kind === 'goal' || i.kind === 'penalty_goal' || i.kind === 'own_goal').length;
  for (; from < incidents.length; from += 1) {
    if (played > wanted) return null;
    if (played === wanted) {
      const scored = scoredKicks(incidents.slice(from));
      const fits = scored.home <= penalties.home && scored.away <= penalties.away;
      const short = penalties.home + penalties.away - scored.home - scored.away;
      return fits && short <= 1 ? from : null;
    }
    if (incidents[from]!.kind === 'penalty_goal') played += 1;
  }
  return null;
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
