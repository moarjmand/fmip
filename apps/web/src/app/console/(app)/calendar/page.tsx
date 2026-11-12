import type { Metadata } from 'next';
import type { ConsoleCalendarEvent } from '@fmip/contracts';
import { dayIn, dayToIso, isoToDay, weekday } from '@fmip/contracts/console';
import { ConsoleLink as Link } from '@/app/console/console-link';
import { consoleCalendar, consoleCalendarPush } from '@/lib/console-api';
import { consoleBase } from '@/lib/console-base';
import {
  AGENDA_DAYS,
  Agenda,
  BellMark,
  type CalendarQuery,
  EventRow,
  MONTHS_G,
  MONTHS_J,
  MonthGrid,
  WeekColumns,
  dateWords,
  eventsOn,
  faInt,
  hrefWith,
  monthOf,
  other,
  readQuery,
  renewalDraft,
  shiftMonth,
  shortDate,
  weekStart,
  weekdayWords,
} from '../../calendar';
import { EventEditor, type EventDraft, blankDraft } from '../../calendar-editor';
import { CalendarPush } from '../../calendar-push';
import { CalendarTabs } from '../../calendar-tabs';
import { Card, when } from '../../ui';

export const metadata: Metadata = { title: 'تقویم و یادآورها' };

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

const UPCOMING_DAYS = 14;

const seg = (on: boolean) =>
  `inline-flex min-h-touch items-center rounded-pill px-3 text-sm font-bold ${
    on ? 'bg-fg text-canvas' : 'text-muted hover:text-fg'
  }`;

/** The heading over the month, the week or the list, with the other calendar under it. */
function heading(query: CalendarQuery): { title: string; sub: string } {
  const { basis } = query;
  if (query.view === 'week') {
    const start = weekStart(query.at);
    return {
      title: `هفتهٔ ${shortDate(basis, start)} تا ${shortDate(basis, start + 6)}`,
      sub: `${shortDate(other(basis), start)} تا ${dateWords(other(basis), start + 6)}`,
    };
  }
  if (query.view === 'agenda')
    return {
      title: `${faInt(AGENDA_DAYS)} روز از ${dateWords(basis, query.at)}`,
      sub: dateWords(other(basis), query.at),
    };
  const { first, length } = monthOf(basis, query.at);
  const p = dayIn(basis, first);
  const names = (b: typeof basis) => (b === 'j' ? MONTHS_J : MONTHS_G);
  const a = dayIn(other(basis), first);
  const z = dayIn(other(basis), first + length - 1);
  const otherNames = names(other(basis));
  return {
    title: `${names(basis)[p.m - 1]} ${faInt(p.y)}`,
    sub:
      a.m === z.m
        ? `${otherNames[a.m - 1]} ${faInt(a.y)}`
        : `${otherNames[a.m - 1]}${a.y !== z.y ? ` ${faInt(a.y)}` : ''} – ${otherNames[z.m - 1]} ${faInt(z.y)}`,
  };
}

/**
 * The console's calendar and reminders (T-1788, D-391), moved from the team
 * board's claude.ai page: the month, the week or a 30-day list in the Solar
 * Hijri or the Gregorian calendar; the selected day and its events; an
 * event's form in the side panel; the next two weeks; and the reminders —
 * switched on per browser, sent by the server, the last ones listed with
 * how many browsers took them. Server-rendered; the forms are server actions.
 */
export default async function ConsoleCalendarPage({ searchParams }: Props) {
  const raw = await searchParams;
  const [result, push, base] = await Promise.all([
    consoleCalendar(),
    consoleCalendarPush(),
    consoleBase(),
  ]);
  if (!result.ok)
    return (
      <Card title="تقویم و یادآورها">
        <p className="text-sm text-danger">
          تقویم خوانده نشد. چند لحظهٔ دیگر صفحه را دوباره باز کنید.
        </p>
      </Card>
    );
  const data = result.data;
  const today = isoToDay(data.today) ?? 0;
  const query = readQuery(raw, today);
  const events = data.events;
  const { title, sub } = heading(query);

  // The editor: an event to change, or a new one (from a day, or from a subscription's renewal).
  let draft: EventDraft | null = null;
  let missing = false;
  let subscriptionName: string | null = null;
  if (query.event !== null) {
    const found = events.find((e) => e.id === query.event);
    if (found === undefined) missing = true;
    else draft = { ...found };
  } else if (query.newOn !== null) {
    draft = blankDraft(dayToIso(query.newOn), query.basis);
    const subscription = data.subscriptions.find((s) => s.key === query.sub);
    if (subscription !== undefined) {
      draft = {
        ...draft,
        ...renewalDraft(subscription),
        time: '09:00',
        repeat: 'monthly',
        basis: 'g',
        remind_minutes: 1440,
        subscription_key: subscription.key,
      };
    }
  }
  if (draft?.subscription_key)
    subscriptionName =
      data.subscriptions.find((s) => s.key === draft?.subscription_key)?.name ?? null;
  const editing = draft !== null || missing;
  const closeHref = hrefWith(query, { event: null, new: null, sub: null });
  const back = closeHref.slice(closeHref.indexOf('?'));

  const step =
    query.view === 'month'
      ? { prev: shiftMonth(query.basis, query.at, -1), next: shiftMonth(query.basis, query.at, 1) }
      : query.view === 'week'
        ? { prev: query.at - 7, next: query.at + 7 }
        : { prev: query.at - AGENDA_DAYS, next: query.at + AGENDA_DAYS };
  const nav = (at: number) =>
    hrefWith(query, { at: dayToIso(at), event: null, new: null, sub: null });

  const selected = eventsOn(events, query.day);
  const upcoming: { day: number; event: ConsoleCalendarEvent }[] = [];
  for (let day = today; day < today + UPCOMING_DAYS; day += 1)
    for (const event of eventsOn(events, day)) upcoming.push({ day, event });

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold">تقویم و یادآورها</h1>
        <p className="max-w-measure text-sm text-muted">
          تقویم مشترک تیم: یادداشت‌ها، جلسه‌ها و تمدیدها، با تکرار و یادآوری. یادآور هر رویداد سر
          وقتش به مرورگرهایی که یادآور را روشن کرده‌اند فرستاده می‌شود. همهٔ ساعت‌ها به وقت تهران
          است.
        </p>
      </div>
      <CalendarTabs current="calendar" />

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <section aria-labelledby="calendar-title" className="flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <div className="me-auto flex min-w-0 flex-col">
              <h2 id="calendar-title" className="text-lg font-bold leading-snug">
                {title}
              </h2>
              <span className="text-xs text-muted">{sub}</span>
            </div>
            <nav
              aria-label="نمای تقویم"
              className="inline-flex rounded-pill border border-default bg-surface p-0.5"
            >
              {(
                [
                  ['month', 'ماه'],
                  ['week', 'هفته'],
                  ['agenda', 'فهرست'],
                ] as const
              ).map(([view, words]) => (
                <Link
                  key={view}
                  href={hrefWith(query, { view })}
                  aria-current={query.view === view ? 'page' : undefined}
                  className={seg(query.view === view)}
                >
                  {words}
                </Link>
              ))}
            </nav>
            <nav
              aria-label="گاه‌شماری"
              className="inline-flex rounded-pill border border-default bg-surface p-0.5"
            >
              <Link
                href={hrefWith(query, { cal: 'j' })}
                aria-current={query.basis === 'j' ? 'page' : undefined}
                className={seg(query.basis === 'j')}
              >
                شمسی
              </Link>
              <Link
                href={hrefWith(query, { cal: 'g' })}
                aria-current={query.basis === 'g' ? 'page' : undefined}
                className={seg(query.basis === 'g')}
              >
                میلادی
              </Link>
            </nav>
            <div className="flex items-center gap-1">
              <Link
                href={nav(step.prev)}
                className="inline-grid size-11 place-items-center rounded-control text-muted hover:bg-surface-raised hover:text-fg"
                aria-label="پیشین"
              >
                <svg
                  aria-hidden="true"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="ltr:-scale-x-100"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </Link>
              <Link
                href={hrefWith(query, {
                  at: dayToIso(today),
                  day: dayToIso(today),
                  event: null,
                  new: null,
                  sub: null,
                })}
                className="inline-flex min-h-touch items-center rounded-control border border-strong px-3 text-sm font-bold text-fg"
              >
                امروز
              </Link>
              <Link
                href={nav(step.next)}
                className="inline-grid size-11 place-items-center rounded-control text-muted hover:bg-surface-raised hover:text-fg"
                aria-label="بعدی"
              >
                <svg
                  aria-hidden="true"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="rtl:-scale-x-100"
                >
                  <path d="m9 6 6 6-6 6" />
                </svg>
              </Link>
            </div>
            <Link
              href={hrefWith(query, { new: dayToIso(query.day), event: null, sub: null })}
              className="inline-flex min-h-touch items-center gap-1 rounded-control bg-brand px-4 text-sm font-bold text-on-brand"
            >
              + رویداد تازه
            </Link>
          </div>

          {query.view === 'month' && <MonthGrid query={query} events={events} today={today} />}
          {query.view === 'week' && <WeekColumns query={query} events={events} today={today} />}
          {query.view === 'agenda' && <Agenda query={query} events={events} today={today} />}
        </section>

        <aside
          aria-label="روز و یادآورها"
          className={`flex min-w-0 flex-col gap-4 ${editing ? 'order-first lg:order-none' : ''}`}
        >
          {missing && (
            <Card title="این رویداد دیگر نیست">
              <p className="text-sm text-muted">شاید هم‌تیمی آن را حذف کرده باشد.</p>
              <Link
                href={closeHref}
                className="mt-2 inline-flex min-h-touch items-center text-sm text-brand"
              >
                بازگشت به تقویم
              </Link>
            </Card>
          )}
          {draft !== null && (
            <EventEditor
              draft={draft}
              basis={query.basis}
              back={back}
              closeHref={closeHref}
              subscriptionName={subscriptionName}
            />
          )}

          <section
            aria-labelledby="day-title"
            className="rounded-card border border-default bg-surface p-4"
          >
            <div className="mb-2 flex items-start gap-3">
              <div className="min-w-0 flex-1">
                <h2
                  id="day-title"
                  className={`text-base font-bold ${weekday(query.day) === 5 ? 'text-danger' : ''}`}
                >
                  {weekdayWords(query.day)} {dateWords(query.basis, query.day)}
                  {query.day === today && (
                    <span className="ms-2 text-xs font-normal text-brand">امروز</span>
                  )}
                </h2>
                <p className="text-xs text-muted">{dateWords(other(query.basis), query.day)}</p>
              </div>
              <Link
                href={hrefWith(query, { new: dayToIso(query.day), event: null, sub: null })}
                className="inline-flex min-h-touch shrink-0 items-center rounded-control border border-strong px-3 text-sm font-bold text-fg"
              >
                + رویداد
              </Link>
            </div>
            {selected.length === 0 ? (
              <p className="py-2 text-sm text-muted">برای این روز چیزی ثبت نشده است.</p>
            ) : (
              <ul className="flex flex-col">
                {selected.map((event) => (
                  <EventRow
                    key={event.id}
                    event={event}
                    href={hrefWith(query, { event: event.id, new: null, sub: null })}
                  />
                ))}
              </ul>
            )}
          </section>

          <section
            aria-labelledby="upcoming-title"
            className="rounded-card border border-default bg-surface p-4"
          >
            <h2 id="upcoming-title" className="mb-2 flex items-center gap-2 text-base font-bold">
              <BellMark size={16} />
              {faInt(UPCOMING_DAYS)} روز آینده
              <span className="rounded-pill bg-surface-raised px-2 text-xs font-normal text-muted">
                {faInt(upcoming.length)}
              </span>
            </h2>
            {upcoming.length === 0 ? (
              <p className="text-sm text-muted">در دو هفتهٔ آینده چیزی نیست.</p>
            ) : (
              <ul className="flex flex-col">
                {upcoming.slice(0, 12).map(({ day, event }) => (
                  <EventRow
                    key={`${event.id}-${day}`}
                    event={event}
                    meta={day === today ? 'امروز' : shortDate(query.basis, day)}
                    href={hrefWith(query, {
                      day: dayToIso(day),
                      at: dayToIso(day),
                      event: event.id,
                      new: null,
                      sub: null,
                    })}
                  />
                ))}
              </ul>
            )}
          </section>

          <section
            aria-labelledby="reminders-title"
            className="rounded-card border border-default bg-surface p-4"
          >
            <h2 id="reminders-title" className="mb-2 text-base font-bold">
              یادآور روی این مرورگر
            </h2>
            <CalendarPush
              configured={push.ok && push.data.state === 'configured'}
              publicKey={push.ok ? push.data.public_key : null}
              devices={push.ok ? push.data.devices : 0}
              workerUrl={`${base}/reminders-worker`}
              scope={`${base}/`}
            />
            <h3 className="mt-4 mb-1 text-sm font-bold">آخرین یادآورهای فرستاده</h3>
            {data.recent_reminders.length === 0 ? (
              <p className="text-sm text-muted">هنوز یادآوری فرستاده نشده است.</p>
            ) : (
              <ul className="flex flex-col text-sm [&>li+li]:border-t [&>li+li]:border-default">
                {data.recent_reminders.map((r) => (
                  <li key={`${r.event_id}-${r.occurs_on}`} className="flex flex-col py-1.5">
                    <span className="truncate font-bold" dir="auto">
                      {r.title}
                    </span>
                    <span className="text-xs text-muted">
                      برای {shortDate(query.basis, isoToDay(r.occurs_on) ?? today)} ·{' '}
                      {when(r.sent_at)} ·{' '}
                      {r.devices === 0
                        ? 'هیچ مرورگری روشن نبود'
                        : `به ${faInt(r.delivered)} از ${faInt(r.devices)} مرورگر رسید`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
