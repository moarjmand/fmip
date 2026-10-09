import type { ScoreCard } from '@fmip/contracts';
import { isBehind } from './live';
import { formatDate, formatDateTime, formatDaysAgo, formatNumber, formatTime } from '@/i18n/format';
import type { Message } from '@/i18n/messages';
import { fill, formatMinute } from '@/lib/words';
import { filterParams, readFilterSelection, type ScoresFilterSelection } from './scores-filters';

/**
 * The scores page's pure helpers (T-031): which day the page shows, the
 * yesterday / today / next-five-days strip, how a card's status and kick-off
 * read in the viewer's zone. No fetching here, so all of it is unit-tested.
 */

/** Yesterday, today and the next five days: blueprint 4.1's browsing range. */
export const DAY_OFFSETS = [-1, 0, 1, 2, 3, 4, 5] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

// Two machine formats, and the only two `Intl` calls in the web app that do
// not go through `@/i18n/format`. `isTimeZone` asks `Intl` whether a zone name
// exists; `dateIn` builds the YYYY-MM-DD key the day tabs are addressed by, on
// `en-CA` because its date order *is* ISO. Neither is read by a person, and
// localising either would make the scores URLs depend on the reader's
// language. `i18n/format.spec.ts` fails if these two literals change.
export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date of `now` in `timeZone`, as YYYY-MM-DD. */
export function dateIn(timeZone: string, now: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string): string => parts.find((p) => p.type === type)?.value ?? '';
  return `${get('year')}-${get('month')}-${get('day')}`;
}

/** `date` plus `days`, as a calendar date (no zone involved: dates are dates). */
export function shiftDate(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

export interface ScoresPageQuery {
  /** The day shown, YYYY-MM-DD in `timezone`. */
  date: string;
  /** Today in `timezone`, so the strip can mark it. */
  today: string;
  timezone: string;
  /** The zone was chosen by the viewer (`?tz=`), so links must carry it. */
  explicitTimezone: boolean;
  live: boolean;
  favourites: boolean;
  /** Country, competition and stage (T-633); absent means none. */
  filters?: ScoresFilterSelection;
}

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined =>
  Array.isArray(v) ? v[0] : v;

/**
 * Reads the page's search parameters. The zone is `?tz=` when given and
 * valid, else the signed-in member's, else UTC; a bad date falls back to
 * today rather than to an error page, because the strip is the way out.
 */
export function readScoresQuery(
  params: Params,
  memberTimezone: string | null,
  now = new Date(),
): ScoresPageQuery {
  const tzParam = first(params.tz);
  const explicitTimezone = tzParam !== undefined && isTimeZone(tzParam);
  const timezone = explicitTimezone
    ? (tzParam as string)
    : memberTimezone !== null && isTimeZone(memberTimezone)
      ? memberTimezone
      : 'UTC';
  const today = dateIn(timezone, now);
  const dateParam = first(params.date);
  const date =
    dateParam !== undefined &&
    DATE.test(dateParam) &&
    !Number.isNaN(Date.parse(`${dateParam}T00:00:00Z`))
      ? dateParam
      : today;
  const flag = (v: string | string[] | undefined): boolean => {
    const s = first(v);
    return s === '1' || s === 'true';
  };
  return {
    date,
    today,
    timezone,
    explicitTimezone,
    live: flag(params.live),
    favourites: flag(params.favourites),
    filters: readFilterSelection(params),
  };
}

/** The API query string for this page state. */
export function apiQuery(q: ScoresPageQuery, to: string = q.date): string {
  const p = new URLSearchParams({ from: q.date, to, tz: q.timezone });
  if (q.live) p.set('live', '1');
  if (q.favourites) p.set('favourites', '1');
  return p.toString();
}

/** A page link that keeps the rest of the state. */
export function pageHref(
  locale: string,
  q: ScoresPageQuery,
  over: Partial<Pick<ScoresPageQuery, 'date' | 'live' | 'favourites' | 'filters'>> = {},
): string {
  const next = { ...q, ...over };
  const p = new URLSearchParams();
  if (next.date !== next.today) p.set('date', next.date);
  if (next.explicitTimezone) p.set('tz', next.timezone);
  if (next.live) p.set('live', '1');
  if (next.favourites) p.set('favourites', '1');
  if (next.filters !== undefined) for (const [k, v] of filterParams(next.filters)) p.set(k, v);
  const query = p.toString();
  return `/${locale}/scores${query === '' ? '' : `?${query}`}`;
}

export interface DayLink {
  date: string;
  /** "Yesterday", "Today", "Tomorrow" or the weekday. */
  label: string;
  isToday: boolean;
  isSelected: boolean;
}

/** The three named days, in the reader's words (T-1303); English when not given. */
export interface DayWords {
  yesterday: string;
  today: string;
  tomorrow: string;
}

const ENGLISH_DAYS: DayWords = { yesterday: 'Yesterday', today: 'Today', tomorrow: 'Tomorrow' };

export function dayStrip(
  q: ScoresPageQuery,
  locale: string,
  words: DayWords = ENGLISH_DAYS,
): DayLink[] {
  return DAY_OFFSETS.map((offset) => {
    const date = shiftDate(q.today, offset);
    const label =
      offset === -1
        ? words.yesterday
        : offset === 0
          ? words.today
          : offset === 1
            ? words.tomorrow
            : formatDate(locale, `${date}T00:00:00Z`, 'UTC', { weekday: 'short', day: 'numeric' });
    return { date, label, isToday: offset === 0, isSelected: date === q.date };
  });
}

/** Kick-off as the viewer sees it, e.g. "20:30". */
export function formatKickoff(locale: string, iso: string, timeZone: string): string {
  return formatTime(locale, iso, timeZone);
}

/** A stored time as a freshness label says it (T-1371). */
export interface FreshnessStamp {
  /** "16:15" today; "yesterday (7 Oct 2026, 16:15)"; "12 days ago (26 Sept 2026, 16:15)". */
  text: string;
  /** Calendar days before today in the viewer's zone; 0 today, negative ahead; null with no clock. */
  days: number | null;
  /** Older than the threshold the caller gave: its surface says the stale words. */
  stale: boolean;
}

/**
 * Every "last updated", "asked" and "checked" time on a live surface (rule 4,
 * T-1371): the clock reading alone only when it is today in the viewer's
 * zone, so "16:15" can never be a time twelve days ago read as this
 * afternoon. Any other day says how many days ago, with the date and time.
 * `staleAfterMs`, when given, is the surface's own threshold (D-045 for a
 * live match, D-127 for an absence answer); past it, `stale` is set and the
 * caller says its stale words beside the time. With no clock (`now`
 * undefined: a render that must stay pure) the full date and time is said,
 * which is never mistaken for today.
 */
export function freshnessStamp(
  locale: string,
  iso: string,
  timeZone: string,
  now: Date | number | undefined,
  staleAfterMs?: number,
): FreshnessStamp {
  if (now === undefined) {
    return { text: formatDateTime(locale, iso, timeZone), days: null, stale: false };
  }
  const nowMs = typeof now === 'number' ? now : now.getTime();
  const atMs = Date.parse(iso);
  const days = Math.round(
    (Date.parse(dateIn(timeZone, new Date(nowMs))) - Date.parse(dateIn(timeZone, new Date(atMs)))) /
      86_400_000,
  );
  const text =
    days === 0
      ? formatTime(locale, iso, timeZone)
      : days > 0
        ? `${formatDaysAgo(locale, days)} (${formatDateTime(locale, iso, timeZone)})`
        : formatDateTime(locale, iso, timeZone);
  const stale = staleAfterMs !== undefined && nowMs - atMs > staleAfterMs;
  return { text, days, stale };
}

/** `freshnessStamp`'s words alone, for a label with no threshold of its own. */
export function formatStamp(
  locale: string,
  iso: string,
  timeZone: string,
  now: Date | number | undefined,
): string {
  return freshnessStamp(locale, iso, timeZone, now).text;
}

/** A status cell's words, resolved for the reader's locale (T-1303). */
export type StatusKey =
  | 'status.live'
  | 'status.behind'
  | 'status.fullTime'
  | 'status.afterExtraTime'
  | 'status.penalties'
  | 'status.postponed'
  | 'status.suspended'
  | 'status.cancelled'
  | 'status.abandoned'
  | 'status.awarded';

const ENGLISH_STATUS: Record<StatusKey, string> = {
  'status.live': 'Live',
  'status.behind': 'Behind',
  'status.fullTime': 'FT',
  'status.afterExtraTime': 'AET',
  'status.penalties': 'Pens',
  'status.postponed': 'Postponed',
  'status.suspended': 'Suspended',
  'status.cancelled': 'Cancelled',
  'status.abandoned': 'Abandoned',
  'status.awarded': 'Awarded',
};

/**
 * The status cell: the clock while live, an abbreviation after, the time
 * before. A live match whose data is behind (T-083) shows "Behind" instead of
 * a minute that is no longer the current one. `words` are the reader's
 * (T-1303); a caller that has none yet gets the English.
 */
export function statusLabel(
  card: Pick<ScoreCard, 'status' | 'minute' | 'scores' | 'kickoff_at' | 'last_updated_at'> &
    Partial<Pick<ScoreCard, 'freshness'>>,
  locale: string,
  timeZone: string,
  now?: number,
  words?: Record<StatusKey, Message>,
): string {
  const w = (key: StatusKey): string => words?.[key].text ?? ENGLISH_STATUS[key];
  switch (card.status) {
    case 'live':
      if (now !== undefined && isBehind(card, now)) return w('status.behind');
      return card.minute === null ? w('status.live') : formatMinute(locale, card.minute, null);
    case 'finished':
      return card.scores.penalties !== null
        ? w('status.penalties')
        : card.scores.extra_time !== null
          ? w('status.afterExtraTime')
          : w('status.fullTime');
    case 'scheduled':
      return formatKickoff(locale, card.kickoff_at, timeZone);
    case 'postponed':
      return w('status.postponed');
    case 'suspended':
      return w('status.suspended');
    case 'cancelled':
      return w('status.cancelled');
    case 'abandoned':
      return w('status.abandoned');
    case 'awarded':
      return w('status.awarded');
  }
}

/**
 * The headline score: the current one, or the full-time one once finished,
 * in the locale's digits (the caller isolates it left to right).
 */
export function scoreLabel(card: ScoreCard, locale = 'en'): string {
  const line =
    card.status === 'finished'
      ? (card.scores.full_time ?? card.scores.current)
      : card.scores.current;
  return line === null
    ? '–'
    : `${formatNumber(locale, line.home)} – ${formatNumber(locale, line.away)}`;
}

/**
 * The freshness line of one block of cards (T-605). A phone has no room for
 * "Updated 20:31" on every row, so the list says it once per competition --
 * and it must stay true for every row it covers (rule 4): one time when the
 * cards agree, else the oldest and the newest, never the newest alone, which
 * would make an older row look current. A row that is behind still says so
 * on the row itself. A time on another day says so (`freshnessStamp`, T-1371).
 */
export function blockUpdatedLabel(
  cards: readonly Pick<ScoreCard, 'last_updated_at'>[],
  locale: string,
  timeZone: string,
  words: Record<'scores.updated' | 'scores.updatedBetween', Message>,
  now?: Date | number,
): string | null {
  const times = cards.map((c) => Date.parse(c.last_updated_at)).filter((t) => !Number.isNaN(t));
  if (times.length === 0) return null;
  const stamp = (ms: number): string =>
    formatStamp(locale, new Date(ms).toISOString(), timeZone, now);
  const oldest = stamp(Math.min(...times));
  const newest = stamp(Math.max(...times));
  return oldest === newest
    ? fill(words['scores.updated'].text, { time: oldest })
    : fill(words['scores.updatedBetween'].text, { oldest, newest });
}

/**
 * The first day after an empty one that has a match, as the viewer's zone
 * names it (T-1331): the windows the page asks for next, each within the
 * API's 14-day cap, so an international break of up to four weeks still
 * points somewhere.
 */
export const NEXT_DAY_WINDOWS: readonly (readonly [number, number])[] = [
  [1, 14],
  [15, 28],
];

export function firstMatchDay(
  data: { pinned: ScoreCard[]; groups: { fixtures: ScoreCard[] }[] },
  timeZone: string,
): string | null {
  const kickoffs = [...data.pinned, ...data.groups.flatMap((g) => g.fixtures)].map(
    (card) => card.kickoff_at,
  );
  if (kickoffs.length === 0) return null;
  const first = kickoffs.reduce((a, b) => (Date.parse(a) <= Date.parse(b) ? a : b));
  return dateIn(timeZone, new Date(first));
}
