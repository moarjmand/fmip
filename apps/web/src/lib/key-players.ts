import type { KeyPlayer, KeyPlayers, KeyPlayersSide } from '@fmip/contracts';
import { KEY_PLAYERS_PER_SIDE } from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, plural, t } from '@/i18n/messages';

/**
 * The words of the match centre's key players (T-841). Pure, so the stated
 * rule and what is said -- and not said -- about availability are one tested
 * place. They are the reader's (T-1303); `locale` defaults to English.
 */

const asLocale = (locale: string): Locale => (isLocale(locale) ? locale : DEFAULT_LOCALE);

/** The footnote: how "key" is chosen, so the selection is a count anyone can check. */
export function ruleNote(competition: string, season: string, locale = 'en'): string {
  return plural(asLocale(locale), 'matchCentre.keyPlayers.rule', KEY_PLAYERS_PER_SIDE, {
    competition,
    season,
  }).text;
}

const POSITION = {
  goalkeeper: 'matchCentre.keyPlayers.position.goalkeeper',
  defender: 'matchCentre.keyPlayers.position.defender',
  midfielder: 'matchCentre.keyPlayers.position.midfielder',
  forward: 'matchCentre.keyPlayers.position.forward',
} as const satisfies Record<NonNullable<KeyPlayer['position']>, Parameters<typeof t>[1]>;

export function positionLabel(position: KeyPlayer['position'], locale = 'en'): string | null {
  return position === null ? null : t(asLocale(locale), POSITION[position]);
}

/** "1,234 min in 15 · 6 goals · 2 assists". */
export function figuresLine(
  player: KeyPlayer,
  format: (n: number) => string,
  locale = 'en',
): string {
  const l = asLocale(locale);
  return [
    interpolate(t(l, 'matchCentre.keyPlayers.minutes'), {
      minutes: format(player.minutes),
      matches: plural(l, 'matchCentre.keyPlayers.matches', player.appearances).text,
    }),
    plural(l, 'matchCentre.keyPlayers.goals', player.goals).text,
    plural(l, 'matchCentre.keyPlayers.assists', player.assists).text,
  ].join(' · ');
}

/**
 * What the provider said about the player for this match. Null when it was
 * never asked: nothing is claimed. A doubt is a doubt, never "out" and never
 * "available".
 */
export function availabilityLine(player: KeyPlayer, locale = 'en'): string | null {
  const l = asLocale(locale);
  const a = player.availability;
  if (a === null) return null;
  if (a.status === 'not_listed') return t(l, 'matchCentre.keyPlayers.notListed');
  const status = t(l, a.status === 'out' ? 'matchCentre.out' : 'matchCentre.doubtful');
  return a.reason === null ? status : `${status} · ${a.reason}`;
}

/**
 * What the key players' footer says about absences (T-1371): the match
 * centre's own state for the match, served by the API as
 * `availability_gap`, so the footer and the Availability module on the same
 * page never disagree. A gap wins over an ask: an ask in a competition the
 * provider has no absences for is no answer.
 */
export type KeyPlayersAbsenceState =
  | { kind: 'asked'; at: string }
  | { kind: 'not_covered' }
  | { kind: 'not_yet' }
  | { kind: 'not_asked' };

export function absenceState(
  players: Pick<KeyPlayers, 'availability_asked_at' | 'availability_gap'>,
): KeyPlayersAbsenceState {
  const gap = players.availability_gap ?? null;
  if (gap === 'not_covered' || gap === 'not_yet') return { kind: gap };
  if (gap === null && players.availability_asked_at !== null) {
    return { kind: 'asked', at: players.availability_asked_at };
  }
  return { kind: 'not_asked' };
}

/** The footer's words for a state that has no time in it. */
export const ABSENCE_STATE_KEY = {
  not_covered: 'matchCentre.keyPlayers.notCovered',
  not_yet: 'matchCentre.keyPlayers.notYet',
  not_asked: 'matchCentre.keyPlayers.notAsked',
} as const satisfies Record<Exclude<KeyPlayersAbsenceState['kind'], 'asked'>, string>;

/** How much of the team's season the figures cover. */
export function coverageLine(side: KeyPlayersSide, locale = 'en'): string {
  const l = asLocale(locale);
  if (side.matches_played === 0) return t(l, 'matchCentre.keyPlayers.noneYet');
  if (side.matches_with_figures < side.matches_played) {
    return plural(l, 'matchCentre.keyPlayers.partial', side.matches_played, {
      with: formatNumber(l, side.matches_with_figures),
    }).text;
  }
  return plural(l, 'matchCentre.keyPlayers.all', side.matches_played).text;
}
