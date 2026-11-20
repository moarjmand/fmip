import { redirect } from 'next/navigation';
import { ConsoleLink as Link } from '@/app/console/console-link';
import type { ReactNode } from 'react';
import { signOut } from '@/lib/console-actions';
import { consoleHeartbeat, consoleMe, consoleRequestCounts } from '@/lib/console-api';
import { consoleBase, consoleUrl } from '@/lib/console-base';
import { ConsoleNav, type ConsoleNavItem } from '@/app/console/console-nav';
import { LiveHeartbeat } from '@/app/console/heartbeat-clock';

export const dynamic = 'force-dynamic';

const NAV = [
  ['/', 'نمای کلی'],
  ['/findings', 'یافته‌ها'],
  ['/reports', 'گزارش‌ها'],
  ['/decisions', 'تصمیم‌ها'],
  ['/requests', 'درخواست‌های هم‌تیمی'],
  ['/checklist', 'فهرست راه‌اندازی'],
  ['/canvas', 'بوم کسب‌وکار'],
  ['/board', 'تابلوی پروژه'],
  ['/calendar', 'تقویم و یادآورها'],
  ['/model', 'مدل پیش‌بینی'],
  ['/providers', 'ارائه‌دهنده‌های داده'],
  ['/social', 'شبکه‌های اجتماعی'],
  ['/audit', 'کارنامه‌ی کنسول'],
] as const;

/**
 * Every console page but sign-in and the invitation (D-340): no session, no
 * page. Links are the console's own paths, under its base (D-341); the proxy
 * maps them under `app/console`.
 */
export default async function ConsoleAppLayout({ children }: { children: ReactNode }) {
  const me = await consoleMe();
  if (!me.ok) redirect(await consoleUrl('/login'));
  // The open requests' count beside their link (T-1728), none when it cannot be
  // read; and the computer's heartbeat on every page (T-1906), said as unread
  // when it cannot.
  const [counts, heartbeat] = await Promise.all([consoleRequestCounts(), consoleHeartbeat()]);
  const now = new Date();
  const openRequests = counts.ok ? counts.data.open : 0;
  const base = await consoleBase();
  const items: ConsoleNavItem[] = await Promise.all(
    NAV.map(async ([path, label]) => ({
      path,
      label,
      href: await consoleUrl(path),
      badge:
        path === '/requests' && openRequests > 0
          ? new Intl.NumberFormat('fa-IR').format(openRequests)
          : null,
    })),
  );
  // T-1871: the menu is a column at the inline-start edge (the right, in
  // Persian) from 1024px, sticky at the window's height with its own scroll;
  // below that a bar, and under it a «فهرست» disclosure opening the same list.
  return (
    <div className="lg:flex lg:items-start">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-default bg-surface px-4 py-2 md:px-8 lg:sticky lg:top-0 lg:h-dvh lg:w-64 lg:shrink-0 lg:flex-col lg:flex-nowrap lg:items-stretch lg:gap-3 lg:border-e lg:border-b-0 lg:px-0 lg:py-4">
        <Link href="/" className="me-auto text-base font-bold text-fg lg:me-0 lg:px-6">
          کنسول عامل‌ها
          <span className="ms-2 text-xs font-normal text-caption">Stadiomind</span>
        </Link>
        <ConsoleNav items={items} base={base} renderedAt={now.getTime()} />
        <div className="flex items-center gap-3 text-sm lg:border-t lg:border-default lg:px-6 lg:pt-3">
          <span className="min-w-0 truncate text-muted">{me.data.display_name}</span>
          <form action={signOut} className="ms-auto">
            <button
              type="submit"
              className="min-h-touch rounded-control border border-strong px-3 text-sm text-fg"
            >
              خروج
            </button>
          </form>
        </div>
      </header>
      <main className="page-frame flex min-w-0 flex-col gap-5 py-5 lg:flex-1">
        <LiveHeartbeat
          heartbeat={heartbeat.ok ? heartbeat.data : null}
          renderedAt={now.getTime()}
        />
        {children}
      </main>
    </div>
  );
}
