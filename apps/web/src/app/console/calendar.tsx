import type {
  ConsoleCalendarEvent,
  ConsoleEventBasis,
  ConsoleEventColor,
  ConsoleSubscription,
  ConsoleSubscriptionStatus,
} from '@fmip/contracts';
import {
  CONSOLE_EVENT_COLORS,
  dayIn,
  dayToIso,
  gregorianToDay,
  isoToDay,
  jalaliToDay,
  monthSpan,
  occursOn,
  weekday,
} from '@fmip/contracts/console';
import type { CSSProperties, ReactNode } from 'react';
import { ConsoleLink as Link } from '@/app/console/console-link';

/**
 * The console's calendar (T-1788, D-391), drawn on the server: the month,
 * the week and the list, the selected day, and the words and colours they
 * share. Days are the contracts' day numbers, so the page and the reminder
 * run agree on which day an event falls on. Persian only (D-352): the
 * Solar Hijri calendar first, the Gregorian beside it.
 */

export type CalendarView = 'month' | 'week' | 'agenda';

/** What the page was asked for, read from its query. */
export interface CalendarQuery {
  view: CalendarView;
  basis: ConsoleEventBasis;
  /** The day the month, week or list is drawn around. */
  at: number;
  /** The day whose events the side panel lists. */
  day: number;
}

export const MONTHS_J = [
  'فروردین',
  'اردیبهشت',
  'خرداد',
  'تیر',
  'مرداد',
  'شهریور',
  'مهر',
  'آبان',
  'آذر',
  'دی',
  'بهمن',
  'اسفند',
];
export const MONTHS_G = [
  'ژانویه',
  'فوریه',
  'مارس',
  'آوریل',
  'مه',
  'ژوئن',
  'ژوئیه',
  'اوت',
  'سپتامبر',
  'اکتبر',
  'نوامبر',
  'دسامبر',
];
/** Sunday first, as `weekday` counts. */
const WEEKDAYS = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
const WEEKDAYS_SHORT = ['ی', 'د', 'س', 'چ', 'پ', 'ج', 'ش'];
/** The Iranian week starts on Saturday. */
const WEEK_START = 6;
const FRIDAY = 5;

export const REPEAT_WORDS = {
  none: 'بدون تکرار',
  daily: 'هر روز',
  weekly: 'هر هفته',
  monthly: 'هر ماه',
  yearly: 'هر سال',
} as const;
export const REMIND_WORDS: Record<string, string> = {
  '': 'بدون یادآوری',
  '0': 'سر وقت',
  '15': '۱۵ دقیقه پیش از آن',
  '60': 'یک ساعت پیش از آن',
  '1440': 'یک روز پیش از آن',
};
export const COLOR_WORDS: Record<ConsoleEventColor, string> = {
  blue: 'آبی',
  green: 'سبز',
  amber: 'زرد',
  orange: 'نارنجی',
  pink: 'سرخابی',
  purple: 'بنفش',
  teal: 'سبزآبی',
  violet: 'ارغوانی',
};
/** Mid tones, mixed with the page's text colour where they are text, so they read in both themes. */
const COLOR_VALUES: Record<ConsoleEventColor, string> = {
  blue: '#2f6fdb',
  green: '#2f9e44',
  amber: '#d9a400',
  orange: '#e8590c',
  pink: '#d6336c',
  purple: '#ae3ec9',
  teal: '#0c8599',
  violet: '#7048e8',
};
export const SUBSCRIPTION_STATUS_WORDS: Record<ConsoleSubscriptionStatus, string> = {
  failing: 'فوری، از کار افتاده',
  active: 'فعال',
  limited: 'رایگان با محدودیت',
  not_taken: 'گرفته نشده',
  unused: 'استفاده نمی‌شود',
  retired: 'کنار گذاشته',
};
export const SUBSCRIPTION_STATUS_TONE: Record<ConsoleSubscriptionStatus, string> = {
  failing: 'border-danger text-danger',
  active: 'border-success text-success',
  limited: 'border-warning text-warning',
  not_taken: 'border-strong text-muted',
  unused: 'border-default text-caption',
  retired: 'border-default text-caption',
};

export const colorStyle = (color: ConsoleEventColor): CSSProperties =>
  ({ '--ev': COLOR_VALUES[color] ?? COLOR_VALUES.blue }) as CSSProperties;
const TINT =
  'bg-[color-mix(in_srgb,var(--ev)_15%,transparent)] text-[color-mix(in_srgb,var(--ev)_72%,var(--color-fg))]';
export const isColor = (value: unknown): value is ConsoleEventColor =>
  (CONSOLE_EVENT_COLORS as readonly unknown[]).includes(value);

/** Persian digits without grouping (a year is ۱۴۰۵, not ۱٬۴۰۵). */
export const faInt = (n: number): string =>
  new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(n);
export const faTime = (time: string): string =>
  time
    .split(':')
    .map((part) => new Intl.NumberFormat('fa-IR', { minimumIntegerDigits: 2 }).format(Number(part)))
    .join(':');

const monthName = (basis: ConsoleEventBasis, m: number): string =>
  (basis === 'j' ? MONTHS_J : MONTHS_G)[m - 1] ?? '';
export const dateWords = (basis: ConsoleEventBasis, day: number): string => {
  const p = dayIn(basis, day);
  return `${faInt(p.d)} ${monthName(basis, p.m)} ${faInt(p.y)}`;
};
export const shortDate = (basis: ConsoleEventBasis, day: number): string => {
  const p = dayIn(basis, day);
  return `${faInt(p.d)} ${monthName(basis, p.m)}`;
};
export const other = (basis: ConsoleEventBasis): ConsoleEventBasis => (basis === 'j' ? 'g' : 'j');
export const weekdayWords = (day: number): string => WEEKDAYS[weekday(day)] ?? '';
/** Both calendars: the page's first, the other after a dot. */
export const bothDates = (basis: ConsoleEventBasis, day: number): string =>
  `${dateWords(basis, day)} · ${dateWords(other(basis), day)}`;

/** The first day of the month `at` is in, and that month's length. */
export function monthOf(basis: ConsoleEventBasis, at: number): { first: number; length: number } {
  const p = dayIn(basis, at);
  return monthSpan(basis, p.y, p.m);
}

/** The first day of the month before or after the one `at` is in. */
export function shiftMonth(basis: ConsoleEventBasis, at: number, by: -1 | 1): number {
  const p = dayIn(basis, at);
  let { y, m } = p;
  m += by;
  if (m < 1) {
    m = 12;
    y -= 1;
  }
  if (m > 12) {
    m = 1;
    y += 1;
  }
  return basis === 'j' ? jalaliToDay(y, m, 1) : gregorianToDay(y, m, 1);
}

export const weekStart = (day: number): number => day - ((weekday(day) - WEEK_START + 7) % 7);

/** The live events that fall on a day, the untimed first, then by time. */
export function eventsOn(
  events: readonly ConsoleCalendarEvent[],
  day: number,
): ConsoleCalendarEvent[] {
  return events
    .filter((event) => occursOn(event, day))
    .sort((a, b) => (a.time ?? '').localeCompare(b.time ?? '') || a.title.localeCompare(b.title));
}

/** The page's query with some keys changed (`null` removes one), as a link. */
export function hrefWith(
  query: CalendarQuery,
  change: Partial<Record<'view' | 'cal' | 'at' | 'day' | 'event' | 'new' | 'sub', string | null>>,
): string {
  const params = new URLSearchParams();
  params.set('view', query.view);
  params.set('cal', query.basis);
  params.set('at', dayToIso(query.at));
  params.set('day', dayToIso(query.day));
  for (const [key, value] of Object.entries(change)) {
    if (value === null || value === undefined) params.delete(key);
    else params.set(key, value);
  }
  return `/calendar?${params.toString()}`;
}

/** Reads the page's query; anything unreadable falls back to today, the month, Solar Hijri. */
export function readQuery(
  raw: Record<string, string | string[] | undefined>,
  today: number,
): CalendarQuery & { event: string | null; newOn: number | null; sub: string | null } {
  const one = (key: string): string | undefined => {
    const value = raw[key];
    return typeof value === 'string' ? value : undefined;
  };
  const view = one('view');
  const day = isoToDay(one('day') ?? '') ?? today;
  const event = one('event');
  const sub = one('sub');
  return {
    view: view === 'week' || view === 'agenda' ? view : 'month',
    basis: one('cal') === 'g' ? 'g' : 'j',
    at: isoToDay(one('at') ?? '') ?? day,
    day,
    event: event !== undefined && /^[0-9a-f-]{36}$/.test(event) ? event : null,
    newOn: isoToDay(one('new') ?? ''),
    sub: sub !== undefined && /^[a-z0-9][a-z0-9-]{0,63}$/.test(sub) ? sub : null,
  };
}

// --- Small pieces ---------------------------------------------------------------

function RepeatMark() {
  return (
    <svg
      aria-hidden="true"
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M17 2l4 4-4 4" />
      <path d="M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4" />
      <path d="M21 13v2a3 3 0 0 1-3 3H3" />
    </svg>
  );
}

export function BellMark({ size = 12 }: { size?: number }) {
  return (
    <svg
      aria-hidden="true"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
      <path d="M10.3 21a1.9 1.9 0 0 0 3.4 0" />
    </svg>
  );
}

/** One event as a row: colour, time, title, and marks for repeat and reminder. */
export function EventRow({
  event,
  href,
  meta,
  compact = false,
}: {
  event: ConsoleCalendarEvent;
  href: string;
  meta?: string;
  /** Title over its time, for the week's narrow columns. */
  compact?: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        className={`flex min-h-touch rounded-control px-2 text-sm hover:bg-surface-raised focus-visible:outline-2 focus-visible:outline-focus ${
          compact
            ? 'flex-col items-start justify-center gap-0.5 border-s-4 border-[var(--ev)] py-1'
            : 'items-center gap-2.5'
        }`}
        style={colorStyle(event.color)}
      >
        {!compact && (
          <span aria-hidden="true" className="size-2.5 shrink-0 rounded-[3px] bg-[var(--ev)]" />
        )}
        <span
          className={`min-w-0 font-bold text-fg ${compact ? 'line-clamp-2 break-words' : 'flex-1 truncate'}`}
          dir="auto"
        >
          {event.title}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted">
          {meta !== undefined && <span>{meta}</span>}
          {event.time !== null && <span>{faTime(event.time)}</span>}
          {event.repeat !== 'none' && (
            <span title={REPEAT_WORDS[event.repeat]}>
              <RepeatMark />
              <span className="sr-only">{REPEAT_WORDS[event.repeat]}</span>
            </span>
          )}
          {event.remind_minutes !== null && (
            <span title="یادآوری دارد">
              <BellMark />
              <span className="sr-only">یادآوری دارد</span>
            </span>
          )}
        </span>
      </Link>
    </li>
  );
}

// --- The month ---------------------------------------------------------------------

export function MonthGrid({
  query,
  events,
  today,
}: {
  query: CalendarQuery;
  events: readonly ConsoleCalendarEvent[];
  today: number;
}) {
  const { basis } = query;
  const { first, length } = monthOf(basis, query.at);
  const offset = (weekday(first) - WEEK_START + 7) % 7;
  const start = first - offset;
  const rows = Math.ceil((offset + length) / 7);
  const second = other(basis);
  const heads = Array.from({ length: 7 }, (_, i) => (WEEK_START + i) % 7);
  return (
    <div className="grid grid-cols-7 gap-1 sm:gap-1.5" data-testid="month">
      <div aria-hidden="true" className="contents">
        {heads.map((w) => (
          <div key={w} className="truncate pb-1 text-center text-xs font-bold text-muted">
            <span className="hidden sm:inline">{WEEKDAYS[w]}</span>
            <span className="sm:hidden">{WEEKDAYS_SHORT[w]}</span>
          </div>
        ))}
      </div>
      {Array.from({ length: rows }, (_, row) => (
        <div key={row} className="contents">
          {Array.from({ length: 7 }, (_, col) => {
            const day = start + row * 7 + col;
            const p = dayIn(basis, day);
            const q = dayIn(second, day);
            const outside = day < first || day >= first + length;
            const on = eventsOn(events, day);
            const selected = day === query.day;
            const isToday = day === today;
            return (
              <Link
                key={day}
                aria-current={isToday ? 'date' : undefined}
                aria-label={`${weekdayWords(day)} ${bothDates(basis, day)}${selected ? '، روز انتخاب‌شده' : ''}${on.length > 0 ? `، ${faInt(on.length)} رویداد` : ''}`}
                href={hrefWith(query, { day: dayToIso(day), event: null, new: null })}
                className={`flex min-h-14 min-w-0 flex-col gap-1 rounded-tile border p-1 text-start sm:min-h-24 sm:p-1.5 focus-visible:outline-2 focus-visible:outline-focus ${
                  selected
                    ? 'border-brand bg-[color-mix(in_srgb,var(--color-brand)_8%,var(--color-surface))]'
                    : 'border-default bg-surface hover:border-strong'
                } ${outside ? 'opacity-50' : ''}`}
              >
                <span className="flex min-w-0 flex-col items-start gap-0 sm:flex-row sm:items-center sm:justify-between sm:gap-1">
                  <b
                    className={`inline-grid size-6 place-items-center rounded-pill text-sm tabular-nums sm:size-7 sm:text-base ${
                      isToday
                        ? 'bg-brand text-on-brand'
                        : weekday(day) === FRIDAY
                          ? 'text-danger'
                          : 'text-fg'
                    }`}
                  >
                    {faInt(p.d)}
                  </b>
                  <small className="truncate text-[10px] text-caption sm:text-[11px]">
                    {faInt(q.d)}
                    {(q.d === 1 || day === start) && (
                      <span className="hidden sm:inline"> {monthName(second, q.m)}</span>
                    )}
                  </small>
                </span>
                <span className="hidden flex-col gap-0.5 sm:flex">
                  {on.slice(0, 3).map((event) => (
                    <span
                      key={event.id}
                      dir="auto"
                      title={
                        event.time !== null ? `${faTime(event.time)} ${event.title}` : event.title
                      }
                      className={`line-clamp-2 break-words rounded-[6px] px-1.5 py-0.5 text-[11.5px] font-bold leading-4 ${TINT}`}
                      style={colorStyle(event.color)}
                    >
                      {event.title}
                    </span>
                  ))}
                  {on.length > 3 && (
                    <span className="px-1 text-[11px] text-muted">+{faInt(on.length - 3)}</span>
                  )}
                </span>
                {on.length > 0 && (
                  <span aria-hidden="true" className="flex flex-wrap gap-0.5 sm:hidden">
                    {on.slice(0, 4).map((event) => (
                      <i
                        key={event.id}
                        className="size-1.5 rounded-pill bg-[var(--ev)]"
                        style={colorStyle(event.color)}
                      />
                    ))}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      ))}
    </div>
  );
}

// --- The week -----------------------------------------------------------------------

export function WeekColumns({
  query,
  events,
  today,
}: {
  query: CalendarQuery;
  events: readonly ConsoleCalendarEvent[];
  today: number;
}) {
  const start = weekStart(query.at);
  return (
    <ol className="grid gap-2 md:grid-cols-7" data-testid="week">
      {Array.from({ length: 7 }, (_, i) => {
        const day = start + i;
        const on = eventsOn(events, day);
        const isToday = day === today;
        return (
          <li
            key={day}
            className={`flex min-w-0 flex-col gap-1 rounded-tile border p-2 ${
              isToday ? 'border-brand' : 'border-default'
            } bg-surface`}
          >
            <Link
              href={hrefWith(query, { day: dayToIso(day), event: null, new: null })}
              className="flex items-baseline justify-between gap-2 rounded-control px-1 hover:bg-surface-raised"
            >
              <span
                className={`text-sm font-bold ${weekday(day) === FRIDAY ? 'text-danger' : 'text-fg'}`}
              >
                {weekdayWords(day)}
              </span>
              <span className="text-xs text-muted">{shortDate(query.basis, day)}</span>
            </Link>
            {on.length === 0 ? (
              <p className="px-1 text-xs text-caption">چیزی نیست</p>
            ) : (
              <ul className="flex flex-col">
                {on.map((event) => (
                  <EventRow
                    key={event.id}
                    compact
                    event={event}
                    href={hrefWith(query, { day: dayToIso(day), event: event.id, new: null })}
                  />
                ))}
              </ul>
            )}
            <Link
              href={hrefWith(query, { day: dayToIso(day), new: dayToIso(day), event: null })}
              className="mt-auto inline-flex min-h-touch items-center rounded-control px-1 text-xs text-muted hover:text-fg"
            >
              + رویداد
            </Link>
          </li>
        );
      })}
    </ol>
  );
}

// --- The list -------------------------------------------------------------------------

export const AGENDA_DAYS = 30;

export function Agenda({
  query,
  events,
  today,
}: {
  query: CalendarQuery;
  events: readonly ConsoleCalendarEvent[];
  today: number;
}) {
  const days = Array.from({ length: AGENDA_DAYS }, (_, i) => query.at + i)
    .map((day) => ({ day, on: eventsOn(events, day) }))
    .filter((d) => d.on.length > 0);
  if (days.length === 0)
    return (
      <p
        className="rounded-tile border border-dashed border-strong p-6 text-center text-sm text-muted"
        data-testid="agenda"
      >
        در {faInt(AGENDA_DAYS)} روز از {dateWords(query.basis, query.at)} چیزی ثبت نشده است.
      </p>
    );
  return (
    <ol className="flex flex-col gap-3" data-testid="agenda">
      {days.map(({ day, on }) => (
        <li key={day} className="rounded-tile border border-default bg-surface p-3">
          <h3 className="mb-1 flex flex-wrap items-baseline gap-x-2 text-sm font-bold">
            <span
              className={
                day === today ? 'text-brand' : weekday(day) === FRIDAY ? 'text-danger' : 'text-fg'
              }
            >
              {weekdayWords(day)} {dateWords(query.basis, day)}
              {day === today && ' · امروز'}
            </span>
            <span className="text-xs font-normal text-caption">
              {dateWords(other(query.basis), day)}
            </span>
          </h3>
          <ul className="flex flex-col">
            {on.map((event) => (
              <EventRow
                key={event.id}
                event={event}
                href={hrefWith(query, { day: dayToIso(day), event: event.id, new: null })}
              />
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}

// --- The subscriptions -------------------------------------------------------------------

export function SubscriptionStatus({ subscription }: { subscription: ConsoleSubscription }) {
  return (
    <span className="flex flex-col items-start gap-0.5">
      <span
        className={`inline-flex items-center whitespace-nowrap rounded-pill border px-2 py-0.5 text-xs font-bold ${
          SUBSCRIPTION_STATUS_TONE[subscription.status]
        }`}
      >
        {SUBSCRIPTION_STATUS_WORDS[subscription.status]}
      </span>
      {subscription.status_note !== '' && (
        <span className="text-xs text-muted" dir="auto">
          {subscription.status_note}
        </span>
      )}
    </span>
  );
}

export function ManageLink({ subscription }: { subscription: ConsoleSubscription }): ReactNode {
  if (subscription.manage_url === null)
    return <span dir="auto">{subscription.manage_label || '—'}</span>;
  return (
    <span className="flex flex-col gap-0.5">
      <a
        href={subscription.manage_url}
        target="_blank"
        rel="noopener noreferrer"
        dir="ltr"
        className="text-brand underline-offset-2 hover:underline"
      >
        {subscription.manage_label || subscription.manage_url.replace(/^https:\/\//, '')}
      </a>
      {subscription.manage_note !== '' && (
        <span className="text-xs text-muted" dir="auto">
          {subscription.manage_note}
        </span>
      )}
    </span>
  );
}

/** A renewal reminder's draft for a subscription: monthly by the Gregorian calendar, a day before at 09:00. */
export function renewalDraft(subscription: ConsoleSubscription): {
  title: string;
  note: string;
  color: ConsoleEventColor;
} {
  const lines = [
    subscription.plan !== '' ? `طرح: ${subscription.plan}` : '',
    subscription.price !== '' ? `قیمت: ${subscription.price}` : '',
    subscription.renewal !== '' ? `تمدید: ${subscription.renewal}` : '',
    subscription.manage_url !== null ? `مدیریت: ${subscription.manage_url}` : '',
    subscription.renew_on === null ? 'تاریخ را با داشبورد سرویس تطبیق دهید.' : '',
  ].filter((line) => line !== '');
  return {
    title: `تمدید ${subscription.name}`,
    note: lines.join('\n'),
    color: subscription.status === 'failing' ? 'pink' : 'orange',
  };
}
