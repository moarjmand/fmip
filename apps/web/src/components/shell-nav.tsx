'use client';

import Link from '@/components/ui/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { Suspense } from 'react';
import { MessageText } from '@/components/message-text';
import type { Message } from '@/i18n/messages';
import { HEADER_NAV, MORE_NAV, type ShellLink, currentLink, tabBarLinks } from '@/lib/shell-nav';

/**
 * The shell's two navigations (T-1381, D-199; Stadiomind, D-267), the only parts of the header
 * that need the pathname: which entry is current. They live in the locale
 * layout, which a client-side navigation does not render again, so the
 * pathname is read here (as `LanguagePicker` does) and the current entry
 * moves with the reader. The words arrive resolved from the header, a server
 * component (T-1040); the catalogues stay on the server.
 *
 * The query counts too (D-281): the matches page's "Not picked yet" view
 * belongs to Predictions. It is read under a Suspense boundary, as Next 16
 * requires for `useSearchParams` on a prerendered route; until it is read,
 * the entry is chosen by the pathname alone.
 */

type Labels = Readonly<Record<string, Message>>;

/**
 * The header's nav (D-263, D-267, D-281): Matches, Competitions,
 * Predictions, The model, News, Highlights (`HEADER_NAV`), then More
 * (`MORE_NAV`: the founder's analysis and Watch). In the bar from 1024px,
 * where More is a disclosure that drops below it; on a phone or a tablet it
 * is the list inside the header's Menu, where globals.css makes More no box
 * at all, so its two links are listed with the rest. The current entry is
 * ink on the raised surface, as the Design System's header draws it
 * (`nav-entry` in globals.css); More is marked too when the page is one of
 * its own.
 *
 * Both disclosures close when the reader chooses a link: the layout is not
 * rendered again on a client-side navigation, so an open Menu or More would
 * otherwise stay open over the new page.
 */
export function PrimaryNav(props: NavProps) {
  return (
    <Suspense fallback={<Nav {...props} search="" />}>
      <NavWithQuery {...props} />
    </Suspense>
  );
}

type NavProps = { locale: string; labels: Labels; className?: string };

function NavWithQuery(props: NavProps) {
  return <Nav {...props} search={useSearchParams().toString()} />;
}

function Nav({ locale, labels, className, search }: NavProps & { search: string }) {
  const pathname = usePathname();
  const current = currentLink(pathname, HEADER_NAV, search);
  const more = currentLink(pathname, MORE_NAV, search);
  // One renderer for both lists: each link is drawn once in the bundle.
  const items = (links: readonly ShellLink[], on: string | null) =>
    links.map((link) => (
      <li key={link.id}>
        <Link
          href={`/${locale}${link.path}`}
          aria-current={link.id === on ? 'page' : undefined}
          data-testid={`nav-${link.id}`}
          className="nav-entry"
        >
          <MessageText message={labels[link.id] ?? { text: link.id, status: 'source' }} />
        </Link>
      </li>
    ));
  return (
    <ul
      className={className}
      data-testid="primary-nav"
      onClick={(event) => {
        // A link chosen: close More and the Menu around it.
        const list = event.currentTarget;
        if ((event.target as Element).closest('a'))
          for (const details of [list.querySelector('details'), list.closest('details')])
            details?.removeAttribute('open');
      }}
    >
      {items(HEADER_NAV, current)}
      <li>
        <details className="more-menu relative" data-testid="nav-more">
          <summary
            data-on={more === null ? undefined : ''}
            className="nav-entry cursor-pointer list-none [&::-webkit-details-marker]:hidden"
          >
            <MessageText message={labels.more ?? { text: 'More', status: 'source' }} />
            <span aria-hidden="true">▾</span>
          </summary>
          <ul className="more-menu-panel more-panel">{items(MORE_NAV, more)}</ul>
        </details>
      </li>
    </ul>
  );
}

/** The five tabs' line icons, the Design System's `TabBar` (24-unit grid, in the text colour). */
const ICONS: Record<string, React.ReactNode> = {
  matches: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 3v18M3 12h18" />
    </>
  ),
  predict: <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />,
  leagues: <path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z" />,
  news: (
    <>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <path d="M7 9h10M7 13h10M7 17h6" />
    </>
  ),
  you: (
    <>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21a8 8 0 0 1 16 0" />
    </>
  ),
};

/**
 * The bottom tab bar, phones only (D-263, D-267): fixed to the bottom below
 * 768px, not drawn from 768px up, where the header's nav takes over. Five
 * tabs, Matches, Predict, Leagues, News, You, each a 22px icon over its
 * label and at least 56px tall (the 44px target and room for the label);
 * the current one is saffron and bold, as the Design System's `TabBar`
 * draws it (`tab-entry` in globals.css), and the bar follows the theme. It keeps clear of the home
 * indicator (`env(safe-area-inset-bottom)`), and a spacer of its height ends
 * the page so the last line of content is never under it. The focus ring is
 * drawn inside a tab, where the screen's edge cannot cut it.
 */
export function BottomTabBar(props: TabBarProps) {
  return (
    <Suspense fallback={<TabBar {...props} search="" />}>
      <TabBarWithQuery {...props} />
    </Suspense>
  );
}

type TabBarProps = {
  locale: string;
  labels: Labels;
  signedIn: boolean;
  /** The landmark's name, resolved by the layout, with its marking. */
  navLabel: { text: string; lang?: string };
};

function TabBarWithQuery(props: TabBarProps) {
  return <TabBar {...props} search={useSearchParams().toString()} />;
}

function TabBar({ locale, labels, signedIn, navLabel, search }: TabBarProps & { search: string }) {
  const links: readonly ShellLink[] = tabBarLinks(signedIn);
  const current = currentLink(usePathname(), links, search);
  return (
    <>
      <div aria-hidden="true" className="h-[calc(4.25rem+env(safe-area-inset-bottom))] md:hidden" />
      <nav
        aria-label={navLabel.text}
        lang={navLabel.lang}
        data-testid="tab-bar"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-default bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
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
                  className="tab-entry focus-inset"
                >
                  <svg
                    viewBox="0 0 24 24"
                    width="22"
                    height="22"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
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
