'use client';

import type { EntityMedia } from '@fmip/contracts';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { EntityImage } from '@/components/entity-image';
import { MessageText } from '@/components/message-text';
import type { Message } from '@/i18n/messages';

/**
 * The competitions bar's links (T-1433), the one part that needs the
 * pathname: which entry is current. The bar lives in the locale layout,
 * which a client-side navigation does not render again, so the pathname is
 * read here (as `PrimaryNav` does). The words arrive resolved (T-1040).
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
  items: readonly { id: string; label: string; logo: EntityMedia }[];
  /** "All competitions", resolved, with its marking. */
  all: Message;
  /** The landmark's name, resolved, with its marking. */
  navLabel: { text: string; lang?: string };
}) {
  const pathname = usePathname();
  const allHref = `/${locale}/competitions`;
  const allCurrent = pathname === allHref;
  const link = 'flex min-h-touch items-center gap-2 rounded-control px-3 text-sm whitespace-nowrap';
  return (
    <nav
      aria-label={navLabel.text}
      lang={navLabel.lang}
      data-mode="editorial"
      data-testid="competitions-bar"
      className="border-b border-default bg-canvas"
    >
      <ul className="page-frame flex items-center gap-1 overflow-x-auto py-1 [scrollbar-width:thin]">
        <li className={`shrink-0 ${items.length > 0 ? 'me-1 border-e border-default pe-1' : ''}`}>
          <Link
            href={allHref}
            aria-current={allCurrent ? 'page' : undefined}
            data-testid="competitions-bar-all"
            className={`${link} font-bold ${
              allCurrent
                ? 'text-accent shadow-[inset_0_-3px_0_var(--token-accent)]'
                : 'text-fg hover:text-accent'
            }`}
          >
            <svg
              viewBox="0 0 24 24"
              width="18"
              height="18"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.8"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              className="shrink-0"
            >
              <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
              <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
              <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
              <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
            </svg>
            <MessageText message={all} />
          </Link>
        </li>
        {items.map((item) => {
          const on = isCompetitionPath(pathname, locale, item.id);
          return (
            <li key={item.id} className="shrink-0">
              <Link
                href={`/${locale}/competition/${item.id}`}
                aria-current={on ? 'page' : undefined}
                data-testid="competitions-bar-item"
                data-competition={item.id}
                className={`${link} ${
                  on
                    ? 'font-bold text-accent shadow-[inset_0_-3px_0_var(--token-accent)]'
                    : 'font-semibold text-fg hover:text-accent'
                }`}
              >
                <EntityImage media={item.logo} kind="logo" name={item.label} size={20} />
                <bdi>{item.label}</bdi>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
