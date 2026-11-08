import { redirect } from 'next/navigation';
import { ConsoleLink as Link } from '@/app/console/console-link';
import type { ReactNode } from 'react';
import { signOut } from '@/lib/console-actions';
import { consoleMe, consoleRequestCounts } from '@/lib/console-api';
import { consoleUrl } from '@/lib/console-base';

export const dynamic = 'force-dynamic';

const NAV = [
  ['/', 'نمای کلی'],
  ['/findings', 'یافته‌ها'],
  ['/reports', 'گزارش‌ها'],
  ['/decisions', 'تصمیم‌ها'],
  ['/requests', 'درخواست‌های هم‌تیمی'],
  ['/board', 'تابلوی پروژه'],
  ['/calendar', 'تقویم و یادآورها'],
  ['/model', 'مدل پیش‌بینی'],
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
  // The open requests' count beside their link (T-1728); none when it cannot be read.
  const counts = await consoleRequestCounts();
  const openRequests = counts.ok ? counts.data.open : 0;
  return (
    <>
      <header className="border-b border-default bg-surface">
        <div className="page-frame flex flex-wrap items-center gap-x-6 gap-y-2 py-3">
          <Link href="/" className="text-base font-bold text-fg">
            کنسول عامل‌ها
            <span className="ms-2 text-xs font-normal text-caption">Stadiomind</span>
          </Link>
          <nav
            aria-label="کنسول"
            className="order-3 w-full overflow-x-auto [scrollbar-width:none] md:order-none md:w-auto"
          >
            <ul className="flex gap-1">
              {NAV.map(([href, label]) => (
                <li key={href}>
                  <Link
                    href={href}
                    className="inline-flex min-h-touch items-center whitespace-nowrap rounded-control px-3 text-sm text-muted hover:bg-surface-raised hover:text-fg"
                  >
                    {label}
                    {href === '/requests' && openRequests > 0 && (
                      <span className="relative ms-1.5 rounded-pill bg-brand px-1.5 text-xs font-bold text-on-brand">
                        {new Intl.NumberFormat('fa-IR').format(openRequests)}
                        <span className="sr-only"> درخواست باز</span>
                      </span>
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className="ms-auto flex items-center gap-3 text-sm">
            <span className="text-muted">{me.data.display_name}</span>
            <form action={signOut}>
              <button
                type="submit"
                className="min-h-touch rounded-control border border-strong px-3 text-sm text-fg"
              >
                خروج
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="page-frame flex flex-col gap-5 py-5">{children}</main>
    </>
  );
}
