'use client';

import Link from '@/components/ui/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { MessageText } from '@/components/message-text';
import type { Message } from '@/i18n/messages';

/**
 * The competitions bar's links (T-1433; drawn as the Design System's pills,
 * T-1513, D-267): the main competitions as rounded pills under the header,
 * then "All competitions" at the end, as the canvas puts it. Not drawn on a
 * phone, where the tab bar's Leagues leads to every competition. Their looks
 * are `pill-entry` and `pill-all` in globals.css, keyed on `aria-current`,
 * so this client component carries no class strings for them (D-264).
 *
 * The bar's one part that needs the pathname: which entry is current. The bar lives in the locale layout,
 * which a client-side navigation does not render again, so the pathname is
 * read here (as `PrimaryNav` does). The words arrive resolved (T-1040),
 * and each logo arrives drawn by the server (`icon`): `EntityImage` imports
 * the contracts package, which would otherwise ride on every page's first
 * load (perf budgets, T-808).
 */

/** Whether `pathname` is this competition's page, any season or tab of it. */
export function isCompetitionPath(pathname: string, locale: string, id: string): boolean {
  const base = `/${locale}/competition/${id}`;
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function CompetitionsBarLinks({
  locale,
  items,
  all,
  navLabel,
}: {
  locale: string;
  items: readonly { id: string; label: string; icon: ReactNode }[];
  /** "All competitions", resolved, with its marking. */
  all: Message;
  /** The landmark's name, resolved, with its marking. */
  navLabel: { text: string; lang?: string };
}) {
  const pathname = usePathname();
  const allHref = `/${locale}/competitions`;
  return (
    <nav
      aria-label={navLabel.text}
      lang={navLabel.lang}
      data-testid="competitions-bar"
      className="border-b border-default bg-canvas max-md:hidden"
    >
      <ul className="page-frame flex items-center gap-2 overflow-x-auto [scrollbar-width:thin]">
        {items.map((item) => (
          <li key={item.id} className="shrink-0">
            <Link
              href={`/${locale}/competition/${item.id}`}
              aria-current={isCompetitionPath(pathname, locale, item.id) ? 'page' : undefined}
              data-testid="competitions-bar-item"
              data-competition={item.id}
              className="pill-entry focus-inset"
            >
              <span>
                {item.icon}
                <bdi>{item.label}</bdi>
              </span>
            </Link>
          </li>
        ))}
        <li className="shrink-0">
          <Link
            href={allHref}
            aria-current={pathname === allHref ? 'page' : undefined}
            data-testid="competitions-bar-all"
            className="pill-all focus-inset"
          >
            <MessageText message={all} />
            <span aria-hidden="true" className="inline-block rtl:-scale-x-100">
              →
            </span>
          </Link>
        </li>
      </ul>
    </nav>
  );
}
