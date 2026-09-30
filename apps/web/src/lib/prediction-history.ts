import type {
  Prediction,
  PredictionHistoryFixture,
  PredictionVersion,
  Settlement,
} from '@fmip/contracts';
import { formatDate } from '@/i18n/format';
import { DEFAULT_LOCALE } from '@/i18n/locales';
import { interpolate, t } from '@/i18n/messages';
import { ltrIsolate } from '@/components/score';
import {
  VOID_REASON_KEY,
  asLocale,
  confidenceText,
  matchTitle,
  outcomeText,
  scoreText,
} from './prediction-text';

/**
 * The prediction history's pure helpers (T-056): how a version, its time and
 * its settlement read, and the paging of the profile's list. No fetching.
 */

export const HISTORY_PAGE_SIZE = 20;

type SearchParams = Record<string, string | string[] | undefined>;

/** `?page=`; a missing or bad value is page one, never an error page. */
export function readHistoryPage(params: SearchParams): number {
  const raw = Array.isArray(params.page) ? params.page[0] : params.page;
  return raw !== undefined && /^\d{1,9}$/.test(raw) && Number(raw) > 0 ? Number(raw) : 1;
}

/** The `GET .../predictions` query string for a page. */
export function historyQuery(page: number): string {
  return `limit=${HISTORY_PAGE_SIZE}&offset=${(page - 1) * HISTORY_PAGE_SIZE}`;
}

export function historyPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
}

/** "Home win 2–1 · confidence 4/5" — the version as the member submitted it. */
export function versionLabel(version: PredictionVersion, locale = 'en'): string {
  const l = asLocale(locale);
  const outcome = outcomeText(l, version.outcome);
  const confidence = confidenceText(l, version.confidence);
  if (version.score === null) {
    return interpolate(t(l, 'history.versionLabel'), { outcome, confidence });
  }
  return interpolate(t(l, 'history.versionLabelScore'), {
    outcome,
    score: isolated(l, scoreText(l, version.score.home, version.score.away)),
    confidence,
  });
}

/**
 * A score inside a sentence, isolated left to right where the page is not
 * English (the English string is left exactly as it always read).
 */
function isolated(locale: string, score: string): string {
  return asLocale(locale) === DEFAULT_LOCALE ? score : ltrIsolate(score);
}

/** Date and time in the viewer's zone, e.g. "05 Jan 2025, 16:28". */
export function formatSubmitted(locale: string, iso: string, timeZone: string): string {
  return formatDate(locale, iso, timeZone, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
}

export type SettlementTone = 'correct' | 'wrong' | 'void' | 'pending' | 'open';

/**
 * How the prediction stands: settled right (exact or outcome), settled wrong,
 * void with the reason, awaiting the result after kick-off, or still open.
 */
export function settlementLabel(
  prediction: Prediction,
  locale = 'en',
): { text: string; tone: SettlementTone } {
  const l = asLocale(locale);
  const s: Settlement | null = prediction.settlement;
  if (s === null) {
    return prediction.locked
      ? { text: t(l, 'history.settlement.awaiting'), tone: 'pending' }
      : { text: t(l, 'history.settlement.open'), tone: 'open' };
  }
  if (s.status === 'void') {
    return {
      text:
        s.void_reason === null
          ? t(l, 'history.settlement.void')
          : interpolate(t(l, 'history.settlement.voidReason'), {
              reason: t(l, VOID_REASON_KEY[s.void_reason]),
            }),
      tone: 'void',
    };
  }
  if (s.outcome_correct === true) {
    return s.score_correct === true
      ? { text: t(l, 'history.settlement.exact'), tone: 'correct' }
      : { text: t(l, 'history.settlement.correct'), tone: 'correct' };
  }
  return { text: t(l, 'history.settlement.wrong'), tone: 'wrong' };
}

/** "Test Home 2–1 Test Away" after the match, "Test Home v Test Away" before. */
export function fixtureLabel(fixture: PredictionHistoryFixture, locale = 'en'): string {
  const home = fixture.home.short_name ?? fixture.home.name;
  const away = fixture.away.short_name ?? fixture.away.name;
  return fixture.score === null
    ? matchTitle(locale, home, away)
    : interpolate(t(asLocale(locale), 'history.fixtureScore'), {
        home,
        away,
        score: isolated(locale, scoreText(locale, fixture.score.home, fixture.score.away)),
      });
}
