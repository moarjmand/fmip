import type { PredictionReasonTag, SettlementVoidReason } from '@fmip/contracts';
import { Fragment, createElement, type ReactNode } from 'react';
import { formatDate, formatDateTime, intlLocale } from '@/i18n/format';
import { DEFAULT_LOCALE, directionOf, isLocale, type Locale } from '@/i18n/locales';
import { type Message, type MessageKey, interpolate, t } from '@/i18n/messages';

/**
 * The words of the prediction surfaces (T-1307): the predictions page, the
 * leaderboard, a member's prediction history, the founder's and the
 * contributors' analysis. Server only -- it reads the catalogues -- so a
 * client component on these surfaces is handed what this resolves.
 *
 * The three prediction products keep their own names in every language (rule
 * 6): the keys below never share a label between the model, the founder and
 * the community.
 */

export function asLocale(locale: string): Locale {
  return isLocale(locale) ? locale : DEFAULT_LOCALE;
}

export const OUTCOME_KEY = {
  home: 'predictions.outcome.home',
  draw: 'predictions.outcome.draw',
  away: 'predictions.outcome.away',
} as const satisfies Record<'home' | 'draw' | 'away', MessageKey>;

export const REASON_TAG_KEY: Record<PredictionReasonTag, MessageKey> = {
  form: 'predictions.reason.form',
  lineup: 'predictions.reason.lineup',
  home_advantage: 'predictions.reason.homeAdvantage',
  injuries: 'predictions.reason.injuries',
  tactics: 'predictions.reason.tactics',
  fatigue: 'predictions.reason.fatigue',
  competition_importance: 'predictions.reason.competitionImportance',
  head_to_head: 'predictions.reason.headToHead',
  motivation: 'predictions.reason.motivation',
};

export const VOID_REASON_KEY: Record<SettlementVoidReason, MessageKey> = {
  postponed: 'history.void.postponed',
  abandoned: 'history.void.abandoned',
  cancelled: 'history.void.cancelled',
  awarded: 'history.void.awarded',
};

/**
 * A number as `String(n)` would print it -- no grouping, every decimal it has --
 * in the locale's own digits. For the figures these pages printed raw (a
 * confidence, a goal count, a rank), so English reads exactly as before.
 */
export function plainNumber(locale: string, value: number): string {
  return new Intl.NumberFormat(intlLocale(locale), {
    useGrouping: false,
    maximumFractionDigits: 20,
  }).format(value);
}

/** A rating to one decimal, always: "72.0" (and "۷۲٫۰" in Persian). */
export function ratingText(locale: string, rating: number): string {
  if (asLocale(locale) === DEFAULT_LOCALE) return rating.toFixed(1);
  return new Intl.NumberFormat(intlLocale(locale), {
    useGrouping: false,
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(rating);
}

/**
 * "2–1", home first, in the locale's digits; the caller isolates it in the
 * page's direction (`ScorePair`, `pairIsolate`; D-193, T-1378).
 */
export function scoreText(locale: string, home: number, away: number): string {
  return `${plainNumber(locale, home)}–${plainNumber(locale, away)}`;
}

/** "confidence 4/5". */
export function confidenceText(locale: string, value: number): string {
  return interpolate(t(asLocale(locale), 'predictions.confidence'), {
    value: plainNumber(locale, value),
    max: plainNumber(locale, 5),
  });
}

/** "Form, Line-up, Tactics", joined the way the locale joins a list. */
export function listText(locale: string, items: readonly string[]): string {
  return new Intl.ListFormat(intlLocale(locale), { type: 'unit', style: 'short' }).format(items);
}

/** "Home win" / "Draw" / "Away win". */
export function outcomeText(locale: string, outcome: keyof typeof OUTCOME_KEY): string {
  return t(asLocale(locale), OUTCOME_KEY[outcome]);
}

/** "Test Home v Test Away". */
export function matchTitle(locale: string, home: string, away: string): string {
  return interpolate(t(asLocale(locale), 'predictions.matchTitle'), { home, away });
}

/**
 * A UTC moment as these pages have always written it in English --
 * "2025-01-05 16:28" -- and in the locale's own calendar and digits elsewhere.
 * The caller says "UTC" through its own sentence.
 */
export function utcStamp(locale: string, iso: string): string {
  if (asLocale(locale) === DEFAULT_LOCALE) return iso.slice(0, 16).replace('T', ' ');
  return formatDate(locale, iso, 'UTC', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

/**
 * The date part alone, "2025-01-05" in English (the ISO date these pages
 * printed), the locale's own date elsewhere.
 */
export function isoDay(locale: string, iso: string, timeZone = 'UTC'): string {
  if (asLocale(locale) === DEFAULT_LOCALE) return iso.slice(0, 10);
  return formatDate(locale, iso, timeZone, { day: 'numeric', month: 'short', year: 'numeric' });
}

/**
 * A stored timestamp shown whole: the ISO string in English, as before, and a
 * date and time in UTC, said to be UTC, elsewhere.
 */
export function rawStamp(locale: string, iso: string): string {
  if (asLocale(locale) === DEFAULT_LOCALE) return iso;
  return interpolate(t(asLocale(locale), 'predictions.utc'), {
    time: formatDateTime(locale, iso, 'UTC'),
  });
}

/**
 * A message whose `{name}` placeholders are elements -- a link, a `<time>` --
 * rather than strings, so a translation can put them where its word order
 * wants them. Marked like `MessageText` when it is the English standing in.
 */
export function richMessage(msg: Message, nodes: Record<string, ReactNode>): ReactNode {
  const children = msg.text
    .split(/\{([a-zA-Z]+)\}/)
    .map((part, index) => (index % 2 === 1 ? (part in nodes ? nodes[part] : `{${part}}`) : part));
  return msg.status === 'untranslated'
    ? createElement(
        'span',
        {
          lang: DEFAULT_LOCALE,
          dir: directionOf(DEFAULT_LOCALE),
          'data-translation': 'untranslated',
        },
        ...children,
      )
    : createElement(Fragment, null, ...children);
}
