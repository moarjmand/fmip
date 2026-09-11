import type { ScoreCard } from '@fmip/contracts';

/**
 * The scores page's pure helpers (T-031): which day the page shows, the
 * yesterday / today / next-five-days strip, how a card's status and kick-off
 * read in the viewer's zone. No fetching here, so all of it is unit-tested.
 */

/** Yesterday, today and the next five days: blueprint 4.1's browsing range. */
export const DAY_OFFSETS = [-1, 0, 1, 2, 3, 4, 5] as const;

const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
  };
}

/** The API query string for this page state. */
export function apiQuery(q: ScoresPageQuery): string {
  const p = new URLSearchParams({ from: q.date, to: q.date, tz: q.timezone });
  if (q.live) p.set('live', '1');
  if (q.favourites) p.set('favourites', '1');
  return p.toString();
}

/** A page link that keeps the rest of the state. */
export function pageHref(
  locale: string,
  q: ScoresPageQuery,
  over: Partial<Pick<ScoresPageQuery, 'date' | 'live' | 'favourites'>> = {},
): string {
  const next = { ...q, ...over };
  const p = new URLSearchParams();
  if (next.date !== next.today) p.set('date', next.date);
  if (next.explicitTimezone) p.set('tz', next.timezone);
  if (next.live) p.set('live', '1');
  if (next.favourites) p.set('favourites', '1');
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

export function dayStrip(q: ScoresPageQuery): DayLink[] {
  return DAY_OFFSETS.map((offset) => {
    const date = shiftDate(q.today, offset);
    const label =
      offset === -1
        ? 'Yesterday'
        : offset === 0
          ? 'Today'
          : offset === 1
            ? 'Tomorrow'
            : new Intl.DateTimeFormat('en-GB', {
                weekday: 'short',
                day: 'numeric',
                timeZone: 'UTC',
              }).format(new Date(`${date}T00:00:00Z`));
    return { date, label, isToday: offset === 0, isSelected: date === q.date };
  });
}

/** Kick-off as the viewer sees it, e.g. "20:30". */
export function formatKickoff(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(iso));
}

/** The status cell: the clock while live, an abbreviation after, the time before. */
export function statusLabel(card: ScoreCard, timeZone: string): string {
  switch (card.status) {
    case 'live':
      return card.minute === null ? 'Live' : `${card.minute}′`;
    case 'finished':
      return card.scores.penalties !== null
        ? 'Pens'
        : card.scores.extra_time !== null
          ? 'AET'
          : 'FT';
    case 'scheduled':
      return formatKickoff(card.kickoff_at, timeZone);
    case 'postponed':
      return 'Postponed';
    case 'suspended':
      return 'Suspended';
    case 'cancelled':
      return 'Cancelled';
    case 'abandoned':
      return 'Abandoned';
    case 'awarded':
      return 'Awarded';
  }
}

/** The headline score: the current one, or the full-time one once finished. */
export function scoreLabel(card: ScoreCard): string {
  const line =
    card.status === 'finished'
      ? (card.scores.full_time ?? card.scores.current)
      : card.scores.current;
  return line === null ? '–' : `${line.home} – ${line.away}`;
}

export const COVERAGE_LABEL = {
  available: 'available',
  limited: 'limited',
  not_supplied: 'not supplied',
  delayed: 'data delayed',
} as const;
