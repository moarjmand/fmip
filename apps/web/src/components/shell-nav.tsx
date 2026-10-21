'use client';

import Link from '@/components/ui/link';
import { usePathname } from 'next/navigation';
import { MessageText } from '@/components/message-text';
import type { Message } from '@/i18n/messages';
import { HEADER_NAV, type ShellLink, currentLink, tabBarLinks } from '@/lib/shell-nav';

/**
 * The shell's two navigations (T-1381, D-199), the only parts of the header
 * that need the pathname: which entry is current. They live in the locale
 * layout, which a client-side navigation does not render again, so the
 * pathname is read here (as `LanguagePicker` does) and the current entry
 * moves with the reader. The words arrive resolved from the header, a server
 * component (T-1040); the catalogues stay on the server.
 */

type Labels = Readonly<Record<string, Message>>;

/**
 * The header's nav: Today, Scores, Predictions, Analysis, News, Watch, Highlights
 * (`HEADER_NAV`). In a row from 768px; on a phone it is the list inside the
 * header's Menu. The current entry is brand green with a bar under it.
 */
export function PrimaryNav({
  locale,
  labels,
  className,
}: {
  locale: string;
  labels: Labels;
  className?: string;
}) {
  const current = currentLink(usePathname(), HEADER_NAV);
  return (
    <ul className={className} data-testid="primary-nav">
      {HEADER_NAV.map((link) => {
        const on = link.id === current;
        return (
          <li key={link.id}>
            <Link
              href={`/${locale}${link.path}`}
              aria-current={on ? 'page' : undefined}
              data-testid={`nav-${link.id}`}
              className={`flex min-h-touch items-center px-3 text-base ${
                on
                  ? 'font-bold text-accent md:shadow-[inset_0_-3px_0_var(--token-accent)]'
                  : 'font-semibold text-fg hover:text-accent'
              }`}
            >
              <MessageText message={labels[link.id] ?? { text: link.id, status: 'source' }} />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

/** The five tabs' line icons (24-unit grid, drawn in the text colour). */
const ICONS: Record<string, React.ReactNode> = {
  today: (
    <>
      <rect x="4" y="5" width="16" height="15" rx="2" />
      <path d="M4 10h16M9 3v4M15 3v4" />
    </>
  ),
  results: <path d="M5 6h14M5 12h14M5 18h9" />,
  predictions: <path d="M5 20v-8M10 20V5M15 20v-6M20 20V9" />,
  news: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="2" />
      <path d="M8 9h8M8 13h8M8 17h5" />
    </>
  ),
  me: (
    <>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20a7.5 7.5 0 0 1 15 0" />
    </>
  ),
};

/**
 * The bottom tab bar, phones only (D-199): fixed to the bottom below 768px,
 * not drawn from 768px up, where the header's nav takes over. Five tabs,
 * each an icon over its label and at least 56px tall; the current one is
 * brand green with a bar along its top. The bar keeps clear of the home
 * indicator (`env(safe-area-inset-bottom)`), and a spacer of its height ends
 * the page so the last line of content is never under it.
 */
export function BottomTabBar({
  locale,
  labels,
  signedIn,
  navLabel,
}: {
  locale: string;
  labels: Labels;
  signedIn: boolean;
  /** The landmark's name, resolved by the layout, with its marking. */
  navLabel: { text: string; lang?: string };
}) {
  const links: readonly ShellLink[] = tabBarLinks(signedIn);
  const current = currentLink(usePathname(), links);
  return (
    <>
      <div aria-hidden="true" className="h-[calc(4.25rem+env(safe-area-inset-bottom))] md:hidden" />
      <nav
        aria-label={navLabel.text}
        lang={navLabel.lang}
        data-mode="editorial"
        data-testid="tab-bar"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-default bg-surface px-1 pb-[calc(0.5rem+env(safe-area-inset-bottom))] md:hidden"
      >
        <ul className="grid grid-cols-5">
          {links.map((link) => {
            const on = link.id === current;
            return (
              <li key={link.id}>
                <Link
                  href={`/${locale}${link.path}`}
                  aria-current={on ? 'page' : undefined}
                  data-testid={`tab-${link.id}`}
                  className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs ${
                    on
                      ? 'font-bold text-accent shadow-[inset_0_3px_0_var(--token-accent)]'
                      : 'font-medium text-muted'
                  }`}
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="22"
                    height="22"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.8"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                    className="shrink-0"
                  >
                    {ICONS[link.id]}
                  </svg>
                  <MessageText message={labels[link.id] ?? { text: link.id, status: 'source' }} />
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
