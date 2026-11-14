import type { Metadata } from 'next';
import { type ConsoleRequestStatus } from '@fmip/contracts';
import { CONSOLE_REQUEST_STATUSES } from '@fmip/contracts/console';
import { ConsoleLink as Link } from '@/app/console/console-link';
import { consoleCalendarPush, consoleRequests } from '@/lib/console-api';
import { consoleBase } from '@/lib/console-base';
import { RequestAlerts } from '../../request-alerts';
import { NewRequestForm } from '../../request-images';
import { REQUEST_STATUS_WORDS, RequestCard } from '../../requests';
import { Card, fa } from '../../ui';

export const metadata: Metadata = { title: 'درخواست‌های هم‌تیمی' };

type Props = { searchParams: Promise<{ status?: string | string[]; by?: string | string[] }> };

/** The tabs: all, then each status in its order. */
const TABS: readonly (ConsoleRequestStatus | 'all')[] = ['all', ...CONSOLE_REQUEST_STATUSES];
const TAB_WORDS = (tab: ConsoleRequestStatus | 'all') =>
  tab === 'all' ? 'همه' : REQUEST_STATUS_WORDS[tab];

/**
 * Teammate requests (T-1728, D-354): what the teammate asks for, written down
 * by the maintainer; Claude's result in front of each one; a question for the
 * teammate with its answers. Server-rendered; the forms are server actions.
 * T-1731 (D-357): pictures on a request, added in the new-request form and on
 * any open card, shown as thumbnails with a lightbox (`request-images.tsx`).
 */
export default async function ConsoleRequestsPage({ searchParams }: Props) {
  const params = await searchParams;
  const raw = params.status;
  const status = (CONSOLE_REQUEST_STATUSES as readonly unknown[]).includes(raw)
    ? (raw as ConsoleRequestStatus)
    : undefined;
  // T-1831 (D-424): one filer's requests, by the console username.
  const rawBy = Array.isArray(params.by) ? params.by[0] : params.by;
  const by = rawBy !== undefined && /^[a-z0-9][a-z0-9_.-]{2,31}$/.test(rawBy) ? rawBy : undefined;
  const [result, base, push] = await Promise.all([
    consoleRequests(status, by),
    consoleBase(),
    consoleCalendarPush(),
  ]);
  const list = result.ok ? result.data : null;
  const current = status ?? 'all';
  const href = (next: { status?: ConsoleRequestStatus; by?: string }) => {
    const query = new URLSearchParams();
    if (next.status !== undefined) query.set('status', next.status);
    if (next.by !== undefined) query.set('by', next.by);
    const q = query.toString();
    return `/requests${q === '' ? '' : `?${q}`}`;
  };
  const filers = list?.filers ?? [];
  const filerName = filers.find((f) => f.username === by)?.display_name ?? by;

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

      <Card>
        <RequestAlerts
          configured={push.ok && push.data.state === 'configured'}
          publicKey={push.ok ? push.data.public_key : null}
          wanted={push.ok && push.data.request_alerts === true}
          workerUrl={`${base}/reminders-worker`}
          scope={`${base}/`}
        />
      </Card>

      <Card title="درخواست تازه">
        <NewRequestForm base={base} />
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
                  href={href({ status: tab === 'all' ? undefined : tab, by })}
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

      {filers.length > 0 && (
        <nav aria-label="ثبت‌کننده" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
          <ul className="flex items-center gap-1.5">
            <li className="whitespace-nowrap text-xs text-muted">ثبت‌کننده:</li>
            {[{ username: undefined, display_name: 'همه', count: null }, ...filers].map((f) => {
              const active = f.username === by;
              return (
                <li key={f.username ?? 'all'}>
                  <Link
                    href={href({ status, by: f.username })}
                    aria-current={active ? 'page' : undefined}
                    className={`inline-flex min-h-touch items-center gap-1.5 whitespace-nowrap rounded-pill border px-3 text-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus ${
                      active
                        ? 'border-accent bg-surface-raised font-bold text-fg'
                        : 'border-default bg-surface text-muted hover:text-fg'
                    }`}
                    data-testid="filer-filter"
                  >
                    <span dir="auto">{f.display_name}</span>
                    {f.count !== null && <span className="text-xs">{fa(f.count)}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}

      {list === null ? (
        <p className="text-sm text-danger" role="alert">
          درخواست‌ها خوانده نشد. کمی بعد دوباره امتحان کنید.
        </p>
      ) : list.requests.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            {by !== undefined
              ? `درخواستی از «${filerName}»${current === 'all' ? '' : ` با وضعیت «${TAB_WORDS(current)}»`} نیست.`
              : current === 'all'
                ? 'هنوز درخواستی ثبت نشده. اولین را از فرم بالا اضافه کنید.'
                : `درخواستی با وضعیت «${TAB_WORDS(current)}» نیست.`}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-4">
          {list.requests.map((request) => (
            <RequestCard key={request.id} request={request} base={base} />
          ))}
        </div>
      )}
    </>
  );
}
