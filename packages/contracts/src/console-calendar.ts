/**
 * The agents console's calendar and reminders (T-1788, D-391), moved from the
 * team board's claude.ai page: notes and reminders on a shared calendar, read
 * in the Solar Hijri or the Gregorian calendar, repeated daily, weekly,
 * monthly or yearly (a month or a year counted in either calendar), and a
 * reminder that reaches each console person's devices by Web Push.
 *
 * Runtime values and the pure day arithmetic live here, on the console's own
 * entry point (`@fmip/contracts/console`), never in the barrel; the barrel
 * exports the types only. The API counts occurrences and reminder times with
 * these functions and the web draws the month with the same ones, so the two
 * never disagree about which day an event falls on.
 *
 * Days are counted as Julian day numbers (a whole number per day, no time
 * zone); a wall-clock time is in `CONSOLE_CALENDAR_TIME_ZONE`, where the
 * team lives.
 */

export const CONSOLE_CALENDAR_TIME_ZONE = 'Asia/Tehran';

export const CONSOLE_EVENT_REPEATS = ['none', 'daily', 'weekly', 'monthly', 'yearly'] as const;
/** Which calendar a monthly or yearly repeat counts its months in: Solar Hijri or Gregorian. */
export const CONSOLE_EVENT_BASES = ['j', 'g'] as const;
/** Minutes before the event a reminder goes out; `null` is no reminder. */
export const CONSOLE_EVENT_REMINDERS = [0, 15, 60, 1440] as const;
export const CONSOLE_EVENT_COLORS = [
  'blue',
  'green',
  'amber',
  'orange',
  'pink',
  'purple',
  'teal',
  'violet',
] as const;
export const CONSOLE_SUBSCRIPTION_STATUSES = [
  'failing',
  'active',
  'limited',
  'not_taken',
  'unused',
  'retired',
] as const;

export const CONSOLE_EVENT_TITLE_MAX = 200;
export const CONSOLE_EVENT_NOTE_MAX = 4000;
/** An event without a time is reminded at this time of its day. */
export const CONSOLE_EVENT_DEFAULT_TIME = '09:00';
/** A reminder missed by more than this (the server was down) is not sent late. */
export const CONSOLE_REMINDER_GRACE_MINUTES = 360;

export type ConsoleEventRepeat = (typeof CONSOLE_EVENT_REPEATS)[number];
export type ConsoleEventBasis = (typeof CONSOLE_EVENT_BASES)[number];
export type ConsoleEventColor = (typeof CONSOLE_EVENT_COLORS)[number];
export type ConsoleSubscriptionStatus = (typeof CONSOLE_SUBSCRIPTION_STATUSES)[number];

/** One note or reminder on the console's calendar. Dates are `YYYY-MM-DD`, times `HH:MM`, both in the team's time zone. */
export interface ConsoleCalendarEvent {
  id: string;
  title: string;
  date: string;
  time: string | null;
  repeat: ConsoleEventRepeat;
  basis: ConsoleEventBasis;
  /** The last day a repeat may fall on; `null` repeats for ever. */
  repeat_until: string | null;
  remind_minutes: number | null;
  note: string;
  color: ConsoleEventColor;
  /** The subscription this event reminds of a renewal of, when it was added from that list. */
  subscription_key: string | null;
  created_at: string;
  updated_at: string;
  updated_by: string | null;
}

/** `POST /console/calendar/events` and `PATCH /console/calendar/events/:id`. */
export interface ConsoleCalendarEventInput {
  title: string;
  date: string;
  time?: string | null;
  repeat?: ConsoleEventRepeat;
  basis?: ConsoleEventBasis;
  repeat_until?: string | null;
  remind_minutes?: number | null;
  note?: string;
  color?: ConsoleEventColor;
  subscription_key?: string | null;
}

/** One service the project depends on, paid or free, with its next renewal. Written only from the computer. */
export interface ConsoleSubscription {
  key: string;
  position: number;
  name: string;
  purpose: string;
  plan: string;
  price: string;
  started: string;
  renewal: string;
  renew_on: string | null;
  status: ConsoleSubscriptionStatus;
  status_note: string;
  limits: string;
  payer: string;
  manage_url: string | null;
  manage_label: string;
  manage_note: string;
  source: string;
  paid: boolean;
  updated_at: string;
}

export type ConsoleSubscriptionInput = Omit<ConsoleSubscription, 'updated_at'>;

/** A reminder the server sent, newest first on the page. */
export interface ConsoleReminderSent {
  event_id: string;
  title: string;
  occurs_on: string;
  sent_at: string;
  /** How many devices took it; 0 with `devices` 0 means nobody had switched reminders on. */
  delivered: number;
  devices: number;
}

/** `GET /console/calendar`. */
export interface ConsoleCalendar {
  events: ConsoleCalendarEvent[];
  subscriptions: ConsoleSubscription[];
  recent_reminders: ConsoleReminderSent[];
  /** Today in the team's time zone, as the server counts it. */
  today: string;
  time_zone: string;
}

/** `GET /console/calendar/push`: whether reminders can reach a device, and how many of this person's devices are on. */
export interface ConsoleCalendarPush {
  state: 'configured' | 'absent';
  public_key: string | null;
  devices: number;
}

/** What the one-off import from the board's claude.ai page carries (`import-calendar`). */
export interface ConsoleCalendarImport {
  events: (ConsoleCalendarEventInput & { source_ref: string })[];
  subscriptions: ConsoleSubscriptionInput[];
}

// --- Day arithmetic: the Solar Hijri and the Gregorian calendar -------------
// The jalaali-js algorithm (Borkowski's leap cycle), on Julian day numbers.

const div = (a: number, b: number): number => Math.trunc(a / b);
const mod = (a: number, b: number): number => a - Math.trunc(a / b) * b;
const BREAKS = [
  -61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394,
  2456, 3178,
];

export interface CalendarDate {
  y: number;
  m: number;
  d: number;
}

function jalaliYear(jy: number): { leap: number; gy: number; march: number } {
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0]!;
  let jump = 0;
  for (let i = 1; i < BREAKS.length; i += 1) {
    const jm = BREAKS[i]!;
    jump = jm - jp;
    if (jy < jm) break;
    leapJ += div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ += div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

/** A Gregorian date's day number. */
export function gregorianToDay(gy: number, gm: number, gd: number): number {
  const d =
    div((gy + div(gm - 8, 6) + 100100) * 1461, 4) +
    div(153 * mod(gm + 9, 12) + 2, 5) +
    gd -
    34840408;
  return d - div(div(gy + 100100 + div(gm - 8, 6), 100) * 3, 4) + 752;
}

export function dayToGregorian(day: number): CalendarDate {
  let j = 4 * day + 139361631;
  j = j + div(div(4 * day + 183187720, 146097) * 3, 4) * 4 - 3908;
  const i = div(mod(j, 1461), 4) * 5 + 308;
  const d = div(mod(i, 153), 5) + 1;
  const m = mod(div(i, 153), 12) + 1;
  return { y: div(j, 1461) - 100100 + div(8 - m, 6), m, d };
}

/** A Solar Hijri date's day number. */
export function jalaliToDay(jy: number, jm: number, jd: number): number {
  const r = jalaliYear(jy);
  return gregorianToDay(r.gy, 3, r.march) + (jm - 1) * 31 - div(jm, 7) * (jm - 7) + jd - 1;
}

export function dayToJalali(day: number): CalendarDate {
  const gy = dayToGregorian(day).y;
  let jy = gy - 621;
  const r = jalaliYear(jy);
  let k = day - gregorianToDay(gy, 3, r.march);
  if (k >= 0) {
    if (k <= 185) return { y: jy, m: 1 + div(k, 31), d: mod(k, 31) + 1 };
    k -= 186;
  } else {
    jy -= 1;
    k += 179;
    if (r.leap === 1) k += 1;
  }
  return { y: jy, m: 7 + div(k, 30), d: mod(k, 30) + 1 };
}

export function jalaliMonthLength(y: number, m: number): number {
  if (m <= 6) return 31;
  if (m <= 11) return 30;
  return jalaliYear(y).leap === 0 ? 30 : 29;
}

export function gregorianMonthLength(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** `YYYY-MM-DD` to a day number; `null` when it is not a real date. */
export function isoToDay(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (match === null) return null;
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])];
  if (m < 1 || m > 12 || d < 1 || d > gregorianMonthLength(y, m)) return null;
  return gregorianToDay(y, m, d);
}

export function dayToIso(day: number): string {
  const g = dayToGregorian(day);
  return `${String(g.y).padStart(4, '0')}-${String(g.m).padStart(2, '0')}-${String(g.d).padStart(2, '0')}`;
}

/** 0 is Sunday, 6 Saturday. */
export const weekday = (day: number): number => mod(day + 1, 7);

/** A month's first day number and its length, in either calendar. */
export function monthSpan(
  basis: ConsoleEventBasis,
  y: number,
  m: number,
): { first: number; length: number } {
  return basis === 'j'
    ? { first: jalaliToDay(y, m, 1), length: jalaliMonthLength(y, m) }
    : { first: gregorianToDay(y, m, 1), length: gregorianMonthLength(y, m) };
}

export const dayIn = (basis: ConsoleEventBasis, day: number): CalendarDate =>
  basis === 'j' ? dayToJalali(day) : dayToGregorian(day);

/** The shape `occursOn` needs: the stored event or an input. */
export interface Recurring {
  date: string;
  repeat: ConsoleEventRepeat;
  basis: ConsoleEventBasis;
  repeat_until: string | null;
}

/**
 * Whether an event falls on a day. A monthly event on a day its month does
 * not have (the 31st, a Solar Hijri Esfand's 30th) falls on that month's
 * last day; a yearly one keeps its month.
 */
export function occursOn(event: Recurring, day: number): boolean {
  const start = isoToDay(event.date);
  if (start === null || day < start) return false;
  if (event.repeat_until !== null) {
    const until = isoToDay(event.repeat_until);
    if (until !== null && day > until) return false;
  }
  switch (event.repeat) {
    case 'none':
      return day === start;
    case 'daily':
      return true;
    case 'weekly':
      return (day - start) % 7 === 0;
    case 'monthly':
    case 'yearly': {
      const a = dayIn(event.basis, start);
      const b = dayIn(event.basis, day);
      if (event.repeat === 'yearly' && a.m !== b.m) return false;
      const length =
        event.basis === 'j' ? jalaliMonthLength(b.y, b.m) : gregorianMonthLength(b.y, b.m);
      return b.d === Math.min(a.d, length);
    }
  }
}

/** Every day from `from` to `to` (both included) the event falls on. */
export function occurrences(event: Recurring, from: number, to: number): number[] {
  const days: number[] = [];
  for (let day = from; day <= to; day += 1) if (occursOn(event, day)) days.push(day);
  return days;
}

// --- Wall-clock time in the team's time zone --------------------------------

/** The date (`YYYY-MM-DD`) and minutes after midnight an instant shows on a wall clock in `zone`. */
export function wallClock(
  instant: Date,
  zone: string = CONSOLE_CALENDAR_TIME_ZONE,
): {
  date: string;
  minutes: number;
} {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const part = (type: string): string => parts.find((p) => p.type === type)?.value ?? '00';
  return {
    date: `${part('year')}-${part('month')}-${part('day')}`,
    minutes: Number(part('hour')) * 60 + Number(part('minute')),
  };
}

/** `HH:MM` to minutes after midnight; `null` when it is not a time. */
export function timeToMinutes(time: string): number | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match === null ? null : Number(match[1]) * 60 + Number(match[2]);
}

/**
 * The instant a wall-clock time on a day is in `zone`. The zone's offset is
 * read at that instant (and read again, so a change of offset on that day
 * lands on the right side of it).
 */
export function wallTimeToInstant(
  day: number,
  minutes: number,
  zone: string = CONSOLE_CALENDAR_TIME_ZONE,
): Date {
  const epoch = gregorianToDay(1970, 1, 1);
  const naive = (day - epoch) * 86400000 + minutes * 60000;
  // The zone's offset at an instant: what its wall clock shows, read as UTC, less the instant.
  const offsetAt = (instant: number): number => {
    const seen = wallClock(new Date(instant), zone);
    const seenDay = isoToDay(seen.date) ?? day;
    return (seenDay - epoch) * 86400000 + seen.minutes * 60000 - instant;
  };
  const first = naive - offsetAt(naive);
  return new Date(naive - offsetAt(first));
}

/** When an event's reminder for one of its days goes out, or `null` when it has none. */
export function reminderAt(
  event: { time: string | null; remind_minutes: number | null },
  day: number,
  zone: string = CONSOLE_CALENDAR_TIME_ZONE,
): Date | null {
  if (event.remind_minutes === null) return null;
  const minutes = timeToMinutes(event.time ?? CONSOLE_EVENT_DEFAULT_TIME) ?? 540;
  const at = wallTimeToInstant(day, minutes, zone);
  return new Date(at.getTime() - event.remind_minutes * 60000);
}
