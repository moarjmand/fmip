import type {
  ConsoleCalendarEventInput,
  ConsoleCalendarImport,
  ConsoleEventBasis,
  ConsoleEventColor,
  ConsoleEventRepeat,
  ConsoleSubscriptionInput,
  ConsoleSubscriptionStatus,
} from '@fmip/contracts';
import {
  CONSOLE_EVENT_BASES,
  CONSOLE_EVENT_COLORS,
  CONSOLE_EVENT_NOTE_MAX,
  CONSOLE_EVENT_REMINDERS,
  CONSOLE_EVENT_REPEATS,
  CONSOLE_EVENT_TITLE_MAX,
  CONSOLE_REMINDER_GRACE_MINUTES,
  CONSOLE_SUBSCRIPTION_STATUSES,
  dayToIso,
  isoToDay,
  occurrences,
  reminderAt,
  timeToMinutes,
} from '@fmip/contracts/console';

/**
 * The calendar's pure part (T-1788, D-391): what a person may write as an
 * event, what the computer may load as a subscription, and which reminders
 * are due at an instant. Nothing here touches the database.
 */

export const EVENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const SUBSCRIPTION_KEY = /^[a-z0-9][a-z0-9-]{0,63}$/;
/** The longest a subscription's text field may be. */
const SUBSCRIPTION_TEXT_MAX = 2000;
/** Events in one import, and subscriptions. */
const IMPORT_MAX = 500;

/** A checked event, every field present. */
export interface EventFields {
  title: string;
  date: string;
  time: string | null;
  repeat: ConsoleEventRepeat;
  basis: ConsoleEventBasis;
  repeat_until: string | null;
  remind_minutes: number | null;
  note: string;
  color: ConsoleEventColor;
  subscription_key: string | null;
}

export type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const oneOf = <T extends string | number>(list: readonly T[], value: unknown): value is T =>
  (list as readonly unknown[]).includes(value);

/** A person's event: title and day required; the rest defaulted. Text is trimmed, never rewritten. */
export function checkEvent(body: unknown): Checked<EventFields> {
  if (!isObject(body)) return { ok: false, reason: 'An event is an object.' };
  const input = body as Partial<Record<keyof ConsoleCalendarEventInput, unknown>>;
  const title = typeof input.title === 'string' ? input.title.trim() : '';
  if (title === '') return { ok: false, reason: 'An event needs a title.' };
  if (title.length > CONSOLE_EVENT_TITLE_MAX)
    return { ok: false, reason: `A title is at most ${CONSOLE_EVENT_TITLE_MAX} characters.` };
  if (typeof input.date !== 'string' || isoToDay(input.date) === null)
    return { ok: false, reason: 'date is a day, YYYY-MM-DD.' };
  const time =
    input.time === undefined || input.time === null || input.time === '' ? null : input.time;
  if (time !== null && (typeof time !== 'string' || timeToMinutes(time) === null))
    return { ok: false, reason: 'time is HH:MM, or empty for the whole day.' };
  const repeat = input.repeat ?? 'none';
  if (!oneOf(CONSOLE_EVENT_REPEATS, repeat))
    return { ok: false, reason: `repeat is one of ${CONSOLE_EVENT_REPEATS.join(', ')}.` };
  const basis = input.basis ?? 'j';
  if (!oneOf(CONSOLE_EVENT_BASES, basis)) return { ok: false, reason: 'basis is j or g.' };
  const until =
    input.repeat_until === undefined || input.repeat_until === null || input.repeat_until === ''
      ? null
      : input.repeat_until;
  if (until !== null) {
    if (typeof until !== 'string' || isoToDay(until) === null)
      return { ok: false, reason: 'repeat_until is a day, YYYY-MM-DD.' };
    if (repeat === 'none') return { ok: false, reason: 'Only a repeating event has an end.' };
    if (until < input.date) return { ok: false, reason: 'A repeat cannot end before it starts.' };
  }
  const remind = input.remind_minutes ?? null;
  if (remind !== null && !oneOf(CONSOLE_EVENT_REMINDERS, remind))
    return {
      ok: false,
      reason: `remind_minutes is one of ${CONSOLE_EVENT_REMINDERS.join(', ')}, or null.`,
    };
  const note = input.note === undefined ? '' : input.note;
  if (typeof note !== 'string') return { ok: false, reason: 'note is text.' };
  if (note.trim().length > CONSOLE_EVENT_NOTE_MAX)
    return { ok: false, reason: `A note is at most ${CONSOLE_EVENT_NOTE_MAX} characters.` };
  const color = input.color ?? 'blue';
  if (!oneOf(CONSOLE_EVENT_COLORS, color))
    return { ok: false, reason: `color is one of ${CONSOLE_EVENT_COLORS.join(', ')}.` };
  const key = input.subscription_key ?? null;
  if (key !== null && (typeof key !== 'string' || !SUBSCRIPTION_KEY.test(key)))
    return { ok: false, reason: 'subscription_key is a subscription key, or null.' };
  return {
    ok: true,
    value: {
      title,
      date: input.date,
      time,
      repeat,
      basis,
      repeat_until: until,
      remind_minutes: remind,
      note: note.trim(),
      color,
      subscription_key: key,
    },
  };
}

const text = (value: unknown): string | null =>
  value === undefined || value === null
    ? ''
    : typeof value === 'string' && value.length <= SUBSCRIPTION_TEXT_MAX
      ? value.trim()
      : null;

/** One subscription from the computer. */
export function checkSubscription(body: unknown): Checked<ConsoleSubscriptionInput> {
  if (!isObject(body)) return { ok: false, reason: 'A subscription is an object.' };
  const key = body.key;
  if (typeof key !== 'string' || !SUBSCRIPTION_KEY.test(key))
    return { ok: false, reason: 'A subscription needs a key: lower-case letters, digits, dashes.' };
  const fields = [
    'name',
    'purpose',
    'plan',
    'price',
    'started',
    'renewal',
    'status_note',
    'limits',
    'payer',
    'manage_label',
    'manage_note',
    'source',
  ] as const;
  const read: Partial<Record<(typeof fields)[number], string>> = {};
  for (const field of fields) {
    const value = text(body[field]);
    if (value === null) return { ok: false, reason: `${key}: ${field} is text.` };
    read[field] = value;
  }
  if (read.name === '') return { ok: false, reason: `${key}: a subscription needs a name.` };
  const status = body.status;
  if (!oneOf<ConsoleSubscriptionStatus>(CONSOLE_SUBSCRIPTION_STATUSES, status))
    return {
      ok: false,
      reason: `${key}: status is one of ${CONSOLE_SUBSCRIPTION_STATUSES.join(', ')}.`,
    };
  const renew = body.renew_on === undefined || body.renew_on === '' ? null : body.renew_on;
  if (renew !== null && (typeof renew !== 'string' || isoToDay(renew) === null))
    return { ok: false, reason: `${key}: renew_on is a day, or empty.` };
  const url = body.manage_url === undefined || body.manage_url === '' ? null : body.manage_url;
  if (url !== null && (typeof url !== 'string' || !/^https:\/\/\S+$/.test(url) || url.length > 500))
    return { ok: false, reason: `${key}: manage_url is an https:// address, or empty.` };
  const position = body.position ?? 0;
  if (typeof position !== 'number' || !Number.isInteger(position))
    return { ok: false, reason: `${key}: position is a whole number.` };
  return {
    ok: true,
    value: {
      key,
      position,
      name: read.name!,
      purpose: read.purpose!,
      plan: read.plan!,
      price: read.price!,
      started: read.started!,
      renewal: read.renewal!,
      renew_on: renew,
      status,
      status_note: read.status_note!,
      limits: read.limits!,
      payer: read.payer!,
      manage_url: url,
      manage_label: read.manage_label!,
      manage_note: read.manage_note!,
      source: read.source!,
      paid: body.paid === true,
    },
  };
}

/** The one-off import: every event and subscription checked, or the first problem. */
export function checkImport(body: unknown): Checked<{
  events: (EventFields & { source_ref: string })[];
  subscriptions: ConsoleSubscriptionInput[];
}> {
  if (!isObject(body)) return { ok: false, reason: 'The import is an object.' };
  const raw = body as Partial<Record<keyof ConsoleCalendarImport, unknown>>;
  const events = raw.events ?? [];
  const subscriptions = raw.subscriptions ?? [];
  if (!Array.isArray(events) || !Array.isArray(subscriptions))
    return { ok: false, reason: 'events and subscriptions are lists.' };
  if (events.length > IMPORT_MAX || subscriptions.length > IMPORT_MAX)
    return { ok: false, reason: `At most ${IMPORT_MAX} of each.` };
  const subs: ConsoleSubscriptionInput[] = [];
  for (const item of subscriptions) {
    const checked = checkSubscription(item);
    if (!checked.ok) return checked;
    subs.push(checked.value);
  }
  const out: (EventFields & { source_ref: string })[] = [];
  for (const item of events) {
    const ref = isObject(item) ? item.source_ref : undefined;
    if (typeof ref !== 'string' || ref.trim() === '' || ref.length > 200)
      return { ok: false, reason: 'Every imported event names its source_ref.' };
    const checked = checkEvent(item);
    if (!checked.ok) return { ok: false, reason: `${ref}: ${checked.reason}` };
    out.push({ ...checked.value, source_ref: ref.trim() });
  }
  return { ok: true, value: { events: out, subscriptions: subs } };
}

/** What the reminder run needs of an event. */
export interface RemindableEvent {
  id: string;
  title: string;
  date: string;
  time: string | null;
  repeat: ConsoleEventRepeat;
  basis: ConsoleEventBasis;
  repeat_until: string | null;
  remind_minutes: number | null;
  updated_at: Date;
}

export interface DueReminder {
  event: RemindableEvent;
  day: string;
  at: Date;
}

/**
 * The reminders due at `now`: every day from yesterday to the day after
 * tomorrow (a day-before reminder of tomorrow's event is due today) whose
 * reminder time has come and is no more than the grace behind. A reminder
 * whose time had passed before the event was last written is not sent:
 * writing an event for this morning does not ring for this morning.
 */
export function dueReminders(
  events: readonly RemindableEvent[],
  now: Date,
  today: number,
): DueReminder[] {
  const due: DueReminder[] = [];
  const grace = CONSOLE_REMINDER_GRACE_MINUTES * 60000;
  for (const event of events) {
    if (event.remind_minutes === null) continue;
    for (const day of occurrences(event, today - 1, today + 2)) {
      const at = reminderAt(event, day);
      if (at === null) continue;
      if (at.getTime() > now.getTime() || now.getTime() - at.getTime() > grace) continue;
      if (at.getTime() < event.updated_at.getTime()) continue;
      due.push({ event, day: dayToIso(day), at });
    }
  }
  return due.sort((a, b) => a.at.getTime() - b.at.getTime());
}
