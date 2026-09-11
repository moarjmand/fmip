import type {
  Prediction,
  PredictionHistoryFixture,
  PredictionVersion,
  Settlement,
  SettlementVoidReason,
} from '@fmip/contracts';
import { OUTCOME_LABEL } from './prediction-form';

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
export function versionLabel(version: PredictionVersion): string {
  const score = version.score === null ? '' : ` ${version.score.home}–${version.score.away}`;
  return `${OUTCOME_LABEL[version.outcome]}${score} · confidence ${version.confidence}/5`;
}

/** Date and time in the viewer's zone, e.g. "05 Jan 2025, 16:28". */
export function formatSubmitted(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

export const VOID_LABEL: Record<SettlementVoidReason, string> = {
  postponed: 'match postponed',
  abandoned: 'match abandoned',
  cancelled: 'match cancelled',
  awarded: 'result awarded off the pitch',
};

export type SettlementTone = 'correct' | 'wrong' | 'void' | 'pending' | 'open';

/**
 * How the prediction stands: settled right (exact or outcome), settled wrong,
 * void with the reason, awaiting the result after kick-off, or still open.
 */
export function settlementLabel(prediction: Prediction): { text: string; tone: SettlementTone } {
  const s: Settlement | null = prediction.settlement;
  if (s === null) {
    return prediction.locked
      ? { text: 'Awaiting result', tone: 'pending' }
      : { text: 'Open until kick-off', tone: 'open' };
  }
  if (s.status === 'void') {
    const reason = s.void_reason === null ? '' : ` — ${VOID_LABEL[s.void_reason]}`;
    return { text: `Void${reason}`, tone: 'void' };
  }
  if (s.outcome_correct === true) {
    return s.score_correct === true
      ? { text: 'Exact score', tone: 'correct' }
      : { text: 'Correct outcome', tone: 'correct' };
  }
  return { text: 'Wrong outcome', tone: 'wrong' };
}

/** "Test Home 2–1 Test Away" after the match, "Test Home v Test Away" before. */
export function fixtureLabel(fixture: PredictionHistoryFixture): string {
  const home = fixture.home.short_name ?? fixture.home.name;
  const away = fixture.away.short_name ?? fixture.away.name;
  return fixture.score === null
    ? `${home} v ${away}`
    : `${home} ${fixture.score.home}–${fixture.score.away} ${away}`;
}
