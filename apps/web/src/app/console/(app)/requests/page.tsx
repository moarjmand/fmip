import type { Metadata } from 'next';
import { type ConsoleRequestStatus } from '@fmip/contracts';
import {
  CONSOLE_REQUEST_BODY_MAX,
  CONSOLE_REQUEST_STATUSES,
  CONSOLE_REQUEST_TITLE_MAX,
} from '@fmip/contracts/console';
import { ConsoleLink as Link } from '@/app/console/console-link';
import { createRequest } from '@/lib/console-actions';
import { consoleRequests } from '@/lib/console-api';
import { ConsoleForm } from '../../console-form';
import { REQUEST_STATUS_WORDS, RequestCard } from '../../requests';
import { Card, fa, inputClass } from '../../ui';

export const metadata: Metadata = { title: 'درخواست‌های هم‌تیمی' };

type Props = { searchParams: Promise<{ status?: string | string[] }> };

/** The tabs: all, then each status in its order. */
const TABS: readonly (ConsoleRequestStatus | 'all')[] = ['all', ...CONSOLE_REQUEST_STATUSES];
const TAB_WORDS = (tab: ConsoleRequestStatus | 'all') =>
  tab === 'all' ? 'همه' : REQUEST_STATUS_WORDS[tab];

/**
 * Teammate requests (T-1728, D-354): what the teammate asks for, written down
 * by the maintainer; Claude's result in front of each one; a question for the
 * teammate with its answers. Server-rendered; the forms are server actions.
 */
export default async function ConsoleRequestsPage({ searchParams }: Props) {
  const raw = (await searchParams).status;
  const status = (CONSOLE_REQUEST_STATUSES as readonly unknown[]).includes(raw)
    ? (raw as ConsoleRequestStatus)
    : undefined;
  const result = await consoleRequests(status);
  const list = result.ok ? result.data : null;
  const current = status ?? 'all';

  return (
    <>
      <div className="flex flex-col gap-2">
        <h1 className="text-xl font-bold">درخواست‌های هم‌تیمی</h1>
        <p className="max-w-measure text-sm text-muted">
          کارهایی که هم‌تیمی می‌خواهد اینجا ثبت می‌شود. Claude فقط وقتی نگهدارنده در گفتگو بگوید روی
          درخواستی کار می‌کند و نتیجه را در کادر روبه‌روی آن می‌نویسد. «اجرا شود» درخواست را در صف
          اجرا می‌گذارد تا با گفتهٔ نگهدارنده اجرا شود.
        </p>
      </div>

      <Card title="درخواست تازه">
        <ConsoleForm action={createRequest} submit="ثبت درخواست" className="flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-muted">
            عنوان
            <input
              name="title"
              required
              maxLength={CONSOLE_REQUEST_TITLE_MAX}
              dir="auto"
              placeholder="هم‌تیمی چه می‌خواهد؟"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-muted">
            جزئیات (اختیاری)
            <textarea
              name="body"
              rows={3}
              maxLength={CONSOLE_REQUEST_BODY_MAX}
              dir="auto"
              className={`${inputClass} py-2`}
            />
          </label>
          <label className="flex items-center gap-2 text-sm text-fg">
            <input type="checkbox" name="priority" value="high" className="size-4 accent-brand" />
            فوری
          </label>
        </ConsoleForm>
      </Card>

      <nav
        aria-label="وضعیت درخواست‌ها"
        className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]"
      >
        <ul className="flex gap-1.5">
          {TABS.map((tab) => {
            const count =
              list === null ? null : tab === 'all' ? list.counts.all : list.counts.by_status[tab];
            const active = tab === current;
            return (
              <li key={tab}>
                <Link
                  href={tab === 'all' ? '/requests' : `/requests?status=${tab}`}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex min-h-touch items-center gap-1.5 whitespace-nowrap rounded-pill border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                    active
                      ? 'border-brand bg-brand font-bold text-on-brand'
                      : 'border-default bg-surface text-muted hover:text-fg'
                  }`}
                >
                  {TAB_WORDS(tab)}
                  {count !== null && (
                    <span
                      className={`rounded-pill px-1.5 text-xs ${
                        active ? 'bg-surface text-fg' : 'bg-surface-raised text-muted'
                      }`}
                    >
                      {fa(count)}
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {list === null ? (
        <p className="text-sm text-danger" role="alert">
          درخواست‌ها خوانده نشد. کمی بعد دوباره امتحان کنید.
        </p>
      ) : list.requests.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            {current === 'all'
              ? 'هنوز درخواستی ثبت نشده. اولین را از فرم بالا اضافه کنید.'
              : `درخواستی با وضعیت «${TAB_WORDS(current)}» نیست.`}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {list.requests.map((request) => (
            <RequestCard key={request.id} request={request} />
          ))}
        </div>
      )}
    </>
  );
}
