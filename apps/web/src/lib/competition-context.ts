import type {
  CompetitionContext,
  CompetitionContextTable,
  CompetitionContextTie,
  ContextStanding,
} from '@fmip/contracts';
import { formatNumber } from '@/i18n/format';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';
import { interpolate, plural, t } from '@/i18n/messages';
import { roundLabel, tieOutcome } from '@/lib/bracket';
import { stageLabel } from '@/lib/stage-label';

/**
 * The words of the match centre's competition context (T-840). Pure, so what
 * a reader is told -- and what they are told is not known -- is one tested
 * place. They are the reader's (T-1303); `locale` defaults to English.
 */

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

const asLocale = (locale: string): Locale => (isLocale(locale) ? locale : DEFAULT_LOCALE);

/** "1 pt", "31 pts", in the reader's words and digits. */
export function pointsLabel(n: number, locale = 'en'): string {
  return plural(asLocale(locale), 'matchCentre.context.points', n).text;
}

/** "2nd of 20 · 31 pts from 14 played". */
export function positionLine(side: ContextStanding, teams: number, locale = 'en'): string {
  const l = asLocale(locale);
  return interpolate(t(l, 'matchCentre.context.position'), {
    position: plural(l, 'team.position', side.position).text,
    teams: formatNumber(l, teams),
    points: pointsLabel(side.points, l),
    played: formatNumber(l, side.played),
  });
}

/** The gaps the table supports: to first, to the place above, over the place below. */
export function gapLines(side: ContextStanding, locale = 'en'): string[] {
  const l = asLocale(locale);
  const say = (key: Parameters<typeof t>[1], points?: number): string =>
    points === undefined ? t(l, key) : interpolate(t(l, key), { points: pointsLabel(points, l) });
  const lines: string[] = [];
  if (side.position === 1) {
    lines.push(
      side.points_clear_of_place_below === null
        ? say('matchCentre.context.leader')
        : say('matchCentre.context.leaderClear', side.points_clear_of_place_below),
    );
    return lines;
  }
  lines.push(say('matchCentre.context.behindFirst', side.points_from_top));
  if (side.points_to_place_above !== null) {
    lines.push(
      side.points_to_place_above === 0
        ? say('matchCentre.context.levelAbove')
        : say('matchCentre.context.behindAbove', side.points_to_place_above),
    );
  }
  if (side.points_clear_of_place_below !== null) {
    lines.push(
      side.points_clear_of_place_below === 0
        ? say('matchCentre.context.levelBelow')
        : say('matchCentre.context.clearBelow', side.points_clear_of_place_below),
    );
  }
  return lines;
}

/** What the table is and how much of it there is. */
export function tableHeading(table: CompetitionContextTable, locale = 'en'): string {
  const l = asLocale(locale);
  return table.scope === 'group' && table.group_name !== null
    ? interpolate(t(l, 'matchCentre.context.groupTable'), { group: table.group_name })
    : t(l, 'matchCentre.context.leagueTable');
}

export function countedLine(table: CompetitionContextTable, locale = 'en'): string {
  const l = asLocale(locale);
  if (table.matches_counted === 0) return t(l, 'matchCentre.context.noneCounted');
  return plural(l, 'matchCentre.context.counted', table.matches_counted).text;
}

/**
 * Said under every table: the places are not in our records, so no gap to
 * them is given (rule 3).
 */
export function placesNote(locale = 'en'): string {
  return t(asLocale(locale), 'matchCentre.context.places');
}

/**
 * The round in words: the UEFA round when known, else the competition's own.
 * The round names are `lib/bracket.ts`'s, shared with the competition page.
 */
export function roundName(tie: CompetitionContextTie, locale = 'en'): string {
  return tie.round_key !== null
    ? roundLabel(tie.round_key, locale)
    : tie.round !== null
      ? (stageLabel(tie.round, (key) => t(asLocale(locale), key), locale) ??
        t(asLocale(locale), 'matchCentre.context.knockoutRound'))
      : t(asLocale(locale), 'matchCentre.context.knockoutRound');
}

/** "Two legs", "One match", or what our records cannot say. */
export function legsNote(tie: CompetitionContextTie, locale = 'en'): string {
  const l = asLocale(locale);
  if (tie.legs_expected === 2) return t(l, 'matchCentre.context.twoLegs');
  if (tie.legs_expected === 1) return t(l, 'matchCentre.context.oneMatch');
  return t(l, 'matchCentre.context.legsUnknown');
}

/** The tie's outcome line, or nothing judged when the legs are unknown. */
export function tieLine(tie: CompetitionContextTie, locale = 'en'): string {
  if (tie.legs_expected === null) return t(asLocale(locale), 'matchCentre.context.notJudged');
  return tieOutcome(tie.tie, tie.legs_expected, locale);
}

/** The sentence for a match with neither a table nor a tie to show. */
export function absenceLine(context: CompetitionContext, locale = 'en'): string {
  const l = asLocale(locale);
  if (context.table !== null && context.table.coverage === 'delayed') {
    return t(l, 'matchCentre.context.tableDelayed');
  }
  if (context.table !== null) return t(l, 'matchCentre.context.noTable');
  return t(
    l,
    context.competition.kind === 'friendly'
      ? 'matchCentre.context.friendly'
      : 'matchCentre.context.neither',
  );
}
