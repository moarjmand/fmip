import Link from '@/components/ui/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { signOut } from '@/lib/console-actions';
import { consoleMe } from '@/lib/console-api';

export const dynamic = 'force-dynamic';

const NAV = [
  ['/', 'نمای کلی'],
  ['/findings', 'یافته‌ها'],
  ['/reports', 'گزارش‌ها'],
  ['/decisions', 'تصمیم‌ها'],
  ['/board', 'تابلوی پروژه'],
  ['/audit', 'کارنامه‌ی کنسول'],
] as const;

/**
 * Every console page but sign-in and the invitation (D-340): no session, no
 * page. Links are the console host's own paths; its proxy maps them under
 * `app/console`.
 */
export default async function ConsoleAppLayout({ children }: { children: ReactNode }) {
  const me = await consoleMe();
  if (!me.ok) redirect('/login');
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
