/**
 * «خریدها و اشتراک‌ها» (T-1788, D-391): the services the project depends on and their renewals, each one put on the calendar.
 */
import type { Metadata } from 'next';
import type { ConsoleCalendarEvent, ConsoleSubscription } from '@fmip/contracts';
import { isoToDay } from '@fmip/contracts/console';
import { ConsoleLink as Link } from '@/app/console/console-link';
import { consoleCalendar } from '@/lib/console-api';
import { ManageLink, SubscriptionStatus, bothDates, faInt } from '../../../calendar';
import { CalendarTabs } from '../../../calendar-tabs';
import { Card, when } from '../../../ui';

export const metadata: Metadata = { title: 'خریدها و اشتراک‌ها' };

const COLUMNS = [
  ['purpose', 'کاربرد'],
  ['plan', 'طرح'],
  ['price', 'قیمت و دورهٔ پرداخت'],
  ['started', 'شروع یا خرید'],
  ['renewal', 'تمدید یا پایان بعدی'],
  ['limits', 'محدودیت‌های طرح'],
  ['payer', 'پرداخت‌کننده و روش'],
  ['source', 'منبع تاریخ'],
] as const;

/** The renewal's calendar link: the event when there is one, a prefilled new one otherwise. */
function CalendarLink({
  subscription,
  event,
  today,
}: {
  subscription: ConsoleSubscription;
  event: ConsoleCalendarEvent | undefined;
  today: string;
}) {
  const base =
    'inline-flex min-h-touch items-center whitespace-nowrap rounded-control border px-3 text-sm font-bold';
  if (event !== undefined)
    return (
      <Link
        href={`/calendar?day=${event.date}&at=${event.date}&event=${event.id}&cal=g`}
        className={`${base} border-success text-success`}
      >
        در تقویم است
      </Link>
    );
  const day =
    subscription.renew_on !== null && subscription.renew_on >= today
      ? subscription.renew_on
      : today;
  return (
    <Link
      href={`/calendar?day=${day}&at=${day}&new=${day}&sub=${subscription.key}&cal=g`}
      className={`${base} border-strong text-fg`}
    >
      افزودن به تقویم
    </Link>
  );
}

/**
 * Purchases and subscriptions (T-1788, D-391), moved from the team board's
 * claude.ai page: every service the project depends on, paid and free,
 * soonest renewal first. Written only from the computer (`import-calendar`),
 * read here; each row puts its renewal on the calendar as a monthly reminder.
 */
export default async function ConsoleSubscriptionsPage() {
  const result = await consoleCalendar();
  if (!result.ok)
    return (
      <Card title="خریدها و اشتراک‌ها">
        <p className="text-sm text-danger">
          فهرست خوانده نشد. چند لحظهٔ دیگر صفحه را دوباره باز کنید.
        </p>
      </Card>
    );
  const { subscriptions, events, today } = result.data;
  const eventOf = (key: string) => events.find((e) => e.subscription_key === key);
  const urgent = subscriptions.filter((s) => s.status === 'failing');
  const paid = subscriptions.filter((s) => s.paid);
  const next = subscriptions
    .filter((s) => s.renew_on !== null && s.renew_on >= today && s.status !== 'failing')
    .sort((a, b) => (a.renew_on ?? '').localeCompare(b.renew_on ?? ''))[0];
  const updated = subscriptions.reduce(
    (latest, s) => (s.updated_at > latest ? s.updated_at : latest),
    '',
  );

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold">خریدها و اشتراک‌ها</h1>
        <p className="max-w-measure text-sm text-muted">
          همهٔ سرویس‌هایی که پروژه به آن‌ها وابسته است، پولی و رایگان، به ترتیب نزدیک‌ترین تمدید.
          تاریخ‌ها میلادی‌اند. «نامعلوم» یعنی فقط از داخل حساب همان سرویس دیده می‌شود. این فهرست را
          Claude از رایانهٔ نگهدارنده به‌روز می‌کند؛ هر ردیف را می‌توان به‌صورت یادآور ماهانه در
          تقویم گذاشت.
        </p>
        {updated !== '' && (
          <p className="text-xs text-caption">آخرین به‌روزرسانی فهرست: {when(updated)}</p>
        )}
      </div>
      <CalendarTabs current="subscriptions" />

      {subscriptions.length === 0 ? (
        <p className="rounded-tile border border-dashed border-strong p-6 text-center text-sm text-muted">
          هنوز سرویسی ثبت نشده است.
        </p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-2 text-sm">
            {urgent.length > 0 && (
              <li className="rounded-pill border border-danger px-3 py-1 font-bold text-danger">
                {faInt(urgent.length)} مورد فوری
              </li>
            )}
            {next !== undefined && (
              <li className="rounded-pill border border-warning px-3 py-1 text-fg">
                تمدید بعدی: <bdi dir="auto">{next.name}</bdi>،{' '}
                {bothDates('g', isoToDay(next.renew_on ?? '') ?? 0)}
              </li>
            )}
            <li className="rounded-pill border border-default px-3 py-1 text-muted">
              {faInt(paid.length)} سرویس پولی
            </li>
            <li className="rounded-pill border border-default px-3 py-1 text-muted">
              {faInt(subscriptions.length)} سرویس
            </li>
          </ul>

          <div className="hidden overflow-x-auto rounded-card border border-default bg-surface lg:block">
            <table className="w-full min-w-[2000px] border-collapse text-sm">
              <thead className="bg-surface-raised text-xs text-muted">
                <tr>
                  <th
                    scope="col"
                    className="sticky start-0 z-10 bg-surface-raised px-3 py-2.5 text-start"
                  >
                    سرویس
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start">
                    وضعیت
                  </th>
                  {COLUMNS.map(([key, words]) => (
                    <th key={key} scope="col" className="px-3 py-2.5 text-start">
                      {words}
                    </th>
                  ))}
                  <th scope="col" className="px-3 py-2.5 text-start">
                    محل مدیریت
                  </th>
                  <th scope="col" className="px-3 py-2.5 text-start">
                    یادآور
                  </th>
                </tr>
              </thead>
              <tbody>
                {subscriptions.map((s) => (
                  <tr
                    key={s.key}
                    className={`border-t border-default align-top ${s.status === 'failing' ? 'bg-[color-mix(in_srgb,var(--color-danger)_7%,var(--color-surface))]' : ''}`}
                  >
                    <th
                      scope="row"
                      className="sticky start-0 bg-inherit px-3 py-2.5 text-start font-bold"
                      dir="auto"
                    >
                      {s.name}
                    </th>
                    <td className="min-w-48 px-3 py-2.5">
                      <SubscriptionStatus subscription={s} />
                    </td>
                    {COLUMNS.map(([key]) => (
                      <td key={key} className="min-w-44 px-3 py-2.5 leading-6" dir="auto">
                        {s[key] || '—'}
                      </td>
                    ))}
                    <td className="min-w-52 px-3 py-2.5">
                      <ManageLink subscription={s} />
                    </td>
                    <td className="px-3 py-2.5">
                      <CalendarLink subscription={s} event={eventOf(s.key)} today={today} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <ul className="flex flex-col gap-3 lg:hidden">
            {subscriptions.map((s) => (
              <li
                key={s.key}
                className={`flex flex-col gap-3 rounded-tile border p-4 ${
                  s.status === 'failing' ? 'border-danger' : 'border-default'
                } bg-surface`}
              >
                <div className="flex flex-wrap items-start gap-2">
                  <h2 className="me-auto text-base font-bold" dir="auto">
                    {s.name}
                  </h2>
                  <SubscriptionStatus subscription={s} />
                </div>
                <dl className="grid grid-cols-[minmax(6rem,auto)_1fr] gap-x-3 gap-y-1.5 text-sm">
                  {COLUMNS.map(([key, words]) => (
                    <div key={key} className="contents">
                      <dt className="text-xs font-bold text-muted">{words}</dt>
                      <dd className="min-w-0 break-words" dir="auto">
                        {s[key] || '—'}
                      </dd>
                    </div>
                  ))}
                  <dt className="text-xs font-bold text-muted">محل مدیریت</dt>
                  <dd className="min-w-0 break-words">
                    <ManageLink subscription={s} />
                  </dd>
                </dl>
                <div>
                  <CalendarLink subscription={s} event={eventOf(s.key)} today={today} />
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
    </>
  );
}
