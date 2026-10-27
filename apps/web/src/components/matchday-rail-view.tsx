'use client';

import Link from '@/components/ui/link';
import { usePathname } from 'next/navigation';
import { type ReactNode, useState } from 'react';
import { MessageText } from '@/components/message-text';
import { ScrollRow } from '@/components/scroll-row';
import type { Message } from '@/i18n/messages';

/**
 * The matchday rail's client half (T-1624, D-292): the one bar under the
 * header, a chip per league, and the drawer under it with one league's
 * matches today. What needs a script: which league the drawer shows, and
 * which entry is the page being read (the rail lives in the locale layout,
 * which a client-side navigation does not render again, so the pathname is
 * read here, as `PrimaryNav` does).
 *
 * Everything else arrives drawn by the server: each logo and status, and
 * every league's drawer (`drawers`, by id). Only the open one is in the
 * page; the server renders it, so without a script the default drawer is
 * there and the rest of the rail is plain links. The looks are `rail-chip`,
 * `rail-all` and `scroll-row` in globals.css, keyed on `aria-current` and
 * `aria-pressed`, so this component carries few class strings (D-264), and
 * `EntityImage`, which imports the contracts package, never rides in it
 * (perf budgets, T-808).
 *
 * A league that plays today is a toggle button (`aria-pressed`, naming the
 * drawer it controls): pressing it shows its matches, pressing it again
 * closes the drawer; its page is the drawer's last link. Any other league
 * is a link to its page. Buttons rather than tabs, because the row mixes
 * them with links (My teams, the other leagues, All competitions).
 *
 * On a phone the rail is compact: only the leagues that play today, then
 * the drawer, and nothing at all on a day without a match (the tab bar's
 * Leagues leads to every competition).
 */

/** Whether `pathname` is this competition's page, any season or tab of it. */
export function isCompetitionPath(pathname: string, locale: string, id: string): boolean {
  const base = `/${locale}/competition/${id}`;
  return pathname === base || pathname.startsWith(`${base}/`);
}

export interface RailItem {
  id: string;
  /** Its short name in the reader's language. */
  label: string;
  /** Its logo, drawn by the server. */
  icon: ReactNode;
  /** Its status ("2 live", "20:00", "Sat"), drawn by the server; `null` for none. */
  status: ReactNode;
  /** Whether it plays today: its chip opens its drawer, and stays on a phone. */
  today: boolean;
}

export const DRAWER_ID = 'rail-drawer';

export function MatchdayRailView({
  locale,
  items,
  drawers,
  initial,
  myTeams,
  all,
  navLabel,
}: {
  locale: string;
  /** The leagues in the rail's order (`railLeagues`). */
  items: readonly RailItem[];
  /** Each league that plays today's drawer, by its id. */
  drawers: Readonly<Record<string, ReactNode>>;
  /** The league whose drawer is open at first (`openLeague`); `null` for none. */
  initial: string | null;
  /** A member's "My teams" chip, its words and star; `null` for a guest. */
  myTeams: { label: Message; icon: ReactNode } | null;
  /** "All competitions", resolved, with its marking. */
  all: Message;
  /** The landmark's name, resolved, with its marking. */
  navLabel: { text: string; lang?: string };
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(initial);
  const playing = items.some((item) => item.today);
  const allHref = `/${locale}/competitions`;
  const shown = open === null ? null : (drawers[open] ?? null);
  const phone = (today: boolean) => (today ? undefined : 'max-md:hidden');

  return (
    <div data-testid="matchday-rail" className={phone(playing)}>
      <nav
        aria-label={navLabel.text}
        lang={navLabel.lang}
        data-testid="competitions-bar"
        className="border-b border-default bg-surface md:bg-canvas"
      >
        <div className="page-frame">
          <ScrollRow listClassName="flex items-center gap-2">
            {myTeams !== null && (
              <li className="max-md:hidden">
                <Link
                  href={`/${locale}/scores?favourites=1`}
                  className="rail-chip focus-inset"
                  data-testid="rail-my-teams"
                >
                  <span>
                    {myTeams.icon}
                    <MessageText message={myTeams.label} />
                  </span>
                </Link>
              </li>
            )}
            {items.map((item) => {
              const face = (
                <span>
                  {item.icon}
                  <bdi>{item.label}</bdi>
                  {item.status}
                </span>
              );
              return (
                <li key={item.id} className={phone(item.today)}>
                  {item.today ? (
                    <button
                      type="button"
                      aria-pressed={open === item.id}
                      aria-controls={DRAWER_ID}
                      onClick={() => setOpen(open === item.id ? null : item.id)}
                      className="rail-chip focus-inset"
                      data-testid="competitions-bar-item"
                      data-competition={item.id}
                    >
                      {face}
                    </button>
                  ) : (
                    <Link
                      href={`/${locale}/competition/${item.id}`}
                      aria-current={
                        isCompetitionPath(pathname, locale, item.id) ? 'page' : undefined
                      }
                      className="rail-chip focus-inset"
                      data-testid="competitions-bar-item"
                      data-competition={item.id}
                    >
                      {face}
                    </Link>
                  )}
                </li>
              );
            })}
            <li className="max-md:hidden">
              <Link
                href={allHref}
                aria-current={pathname === allHref ? 'page' : undefined}
                data-testid="competitions-bar-all"
                className="rail-all focus-inset"
              >
                <MessageText message={all} />
                <span aria-hidden="true" className="inline-block rtl:-scale-x-100">
                  →
                </span>
              </Link>
            </li>
          </ScrollRow>
        </div>
      </nav>
      {playing && (
        <div id={DRAWER_ID} hidden={shown === null} data-testid="rail-drawer">
          {shown}
        </div>
      )}
    </div>
  );
}
