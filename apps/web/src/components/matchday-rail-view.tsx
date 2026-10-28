'use client';

import Link from '@/components/ui/link';
import { unstable_isUnrecognizedActionError, usePathname } from 'next/navigation';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useLite } from '@/components/lite-mode';
import { MessageText } from '@/components/message-text';
import { ScrollRow } from '@/components/scroll-row';
import type { Message } from '@/i18n/messages';
import { LITE_POLL_MS } from '@/lib/lite';
import { LIVE_MOVED, RAIL_POLL_MS } from '@/lib/live-signal';
import { refreshRail } from '@/lib/rail-actions';

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
 *
 * Kept current (T-1635, D-297). Because the layout is never drawn again on a
 * client-side navigation, the rail asks the server to draw it again
 * (`refreshRail`) and puts the answer in place of what it had: every
 * `RAIL_POLL_MS` while a match today is being played (`askIn` 0), once at
 * the next kick-off or the next day otherwise, never while the page is
 * hidden (it asks when the page is shown again), and at once when the page's
 * own stream saw a match move (`LIVE_MOVED`). An idle day asks nothing. When
 * the answers stop coming, the statuses are marked from `behindAt` on
 * (`data-behind`, rule 4) and the drawer says "May be behind".
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

export interface RailProps {
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
  /** The reader's zone and whether a member: what the rail is asked for again with. */
  timeZone: string;
  signedIn: boolean;
  /** Milliseconds after this answer to ask again; 0 while a match is played (`railAskIn`). */
  askIn: number;
  /** When the statuses may be behind (epoch ms), `null` when nothing can change today. */
  behindAt: number | null;
  /** Already behind when the server drew it (a live match's data had stopped). */
  behind: boolean;
}

export const DRAWER_ID = 'rail-drawer';

/** A burst of `LIVE_MOVED` (a goal, then its card) asks once. */
const MOVED_GAP_MS = 5_000;
/** `setTimeout` takes at most 2^31 - 1 ms; the rail never waits that long. */
const LONGEST_WAIT_MS = 2_147_000_000;
/** An ask with no answer after this long is taken as failed and tried again a poll later. */
const ASK_TIMEOUT_MS = 20_000;

/**
 * Asks for the rail again while it can change, and hands each answer to
 * `replace`. The schedule is the answer's own (`askIn`), so each new answer
 * sets the next ask; a failed ask is tried again a poll later. An answer
 * draws only the drawer that is open (`wanted`); opening one the last
 * answer did not draw asks at once.
 */
function useRailRefresh(
  rail: RailProps,
  wanted: string | null,
  replace: (next: RailProps) => void,
): void {
  const { on: lite } = useLite();
  const lastAsk = useRef(0);
  const retired = useRef(false);
  // The drawer the last answer was asked for: one it could not draw is not asked for again at once.
  const answered = useRef<string | null | undefined>(undefined);

  // Run again for every answer, even one with the same `askIn`: it sets the next ask.
  useEffect(() => {
    const { locale, timeZone, signedIn, askIn } = rail;
    const poll = lite ? LITE_POLL_MS : RAIL_POLL_MS;
    const missing = wanted !== null && !(wanted in rail.drawers) && answered.current !== wanted;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let busy = false;
    let waiting = false;
    let stopped = false;

    const later = (wait: number): void => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => ask(false), Math.min(Math.max(0, wait), LONGEST_WAIT_MS));
    };
    const ask = (fresh: boolean): void => {
      if (busy || stopped || retired.current) return;
      // A hidden page asks nothing; it asks when it is shown again.
      if (document.visibilityState === 'hidden') {
        waiting = true;
        return;
      }
      busy = true;
      waiting = false;
      lastAsk.current = Date.now();
      // An answer that never comes (a connection left hanging) must not stop
      // the asking: past `ASK_TIMEOUT_MS` it counts as failed.
      let settled = false;
      const settle = (): boolean => {
        if (settled) return false;
        settled = true;
        busy = false;
        clearTimeout(guard);
        return !stopped;
      };
      const guard = setTimeout(() => {
        if (settle()) later(poll);
      }, ASK_TIMEOUT_MS);
      refreshRail(locale, timeZone, signedIn, fresh, wanted).then(
        (next) => {
          if (!settle()) return;
          if (next === null) {
            later(poll);
            return;
          }
          answered.current = wanted;
          replace(next);
        },
        (error: unknown) => {
          if (!settle()) return;
          // A page from an earlier build: its Server Function is gone and no
          // answer will come; the next navigation loads the new build. The
          // statuses are marked behind in the meantime (rule 4).
          if (unstable_isUnrecognizedActionError(error)) retired.current = true;
          else later(poll);
        },
      );
    };
    const onShown = (): void => {
      if (document.visibilityState === 'visible' && waiting) ask(false);
    };
    const onMoved = (): void => {
      if (Date.now() - lastAsk.current >= MOVED_GAP_MS) ask(true);
    };

    later(missing ? 0 : askIn === 0 ? poll : askIn);
    document.addEventListener('visibilitychange', onShown);
    window.addEventListener(LIVE_MOVED, onMoved);
    return () => {
      stopped = true;
      if (timer !== null) clearTimeout(timer);
      document.removeEventListener('visibilitychange', onShown);
      window.removeEventListener(LIVE_MOVED, onMoved);
    };
  }, [rail, wanted, lite, replace]);
}

/** Whether `behindAt` has passed: the server's word, or the clock reaching it since. */
function useBehind(behindAt: number | null, already: boolean): boolean {
  const [passed, setPassed] = useState<number | null>(null);
  useEffect(() => {
    if (behindAt === null) return;
    const wait = Math.min(Math.max(0, behindAt - Date.now()), LONGEST_WAIT_MS);
    const timer = setTimeout(() => setPassed(behindAt), wait);
    return () => clearTimeout(timer);
  }, [behindAt]);
  return already || (behindAt !== null && passed === behindAt);
}

/** The drawer being shown, and whether the reader chose it (or shut it) rather than the server. */
interface OpenDrawer {
  id: string | null;
  chosen: boolean;
}

const playingToday = (next: Pick<RailProps, 'items'>): Set<string> =>
  new Set(next.items.filter((item) => item.today).map((item) => item.id));

/**
 * The drawer once a new answer is in. One the reader opened stays while its
 * league plays today, as does one they shut; one that is gone gives way to
 * the answer's default, as a page load would. The server's default is never
 * swapped under a reader for another league's while it still plays.
 */
export function drawerAfter(open: OpenDrawer, next: Pick<RailProps, 'items' | 'initial'>) {
  if (open.id !== null && playingToday(next).has(open.id)) return open;
  if (open.id === null && open.chosen) return open;
  return { id: next.initial, chosen: false };
}

/**
 * Every drawer the rail has, once a new answer is in: the answer's (only the
 * open one, when it was asked for again) over the ones drawn before, less
 * those of leagues no longer playing today. A kept drawer is shown only
 * until the answer for it comes (`useRailRefresh` asks at once), and says
 * itself when it is behind.
 */
export function keptDrawers(
  kept: Readonly<Record<string, ReactNode>>,
  next: Pick<RailProps, 'items' | 'drawers'>,
): Record<string, ReactNode> {
  const today = playingToday(next);
  return {
    ...Object.fromEntries(Object.entries(kept).filter(([id]) => today.has(id))),
    ...next.drawers,
  };
}

export function MatchdayRailView(props: RailProps) {
  const pathname = usePathname();
  // The rail as last drawn: the server's on a page load, then each answer.
  const [rail, setRail] = useState(props);
  const [drawers, setDrawers] = useState(props.drawers);
  const [drawn, setDrawn] = useState(props);
  const [open, setOpen] = useState<OpenDrawer>({ id: props.initial, chosen: false });
  const [show] = useState(() => (next: RailProps) => {
    setRail(next);
    setDrawers((kept) => keptDrawers(kept, next));
    setOpen((current) => drawerAfter(current, next));
  });
  // A layout the server drew again (`router.refresh()`) is the newest answer.
  if (props !== drawn) {
    setDrawn(props);
    show(props);
  }
  useRailRefresh(rail, open.id, show);
  const behind = useBehind(rail.behindAt, rail.behind);

  const { locale, items, myTeams, all, navLabel } = rail;
  const playing = items.some((item) => item.today);
  const allHref = `/${locale}/competitions`;
  const shown = open.id === null ? null : (drawers[open.id] ?? null);
  const phone = (today: boolean) => (today ? undefined : 'max-md:hidden');

  return (
    <div
      data-testid="matchday-rail"
      data-behind={behind ? 'true' : undefined}
      className={phone(playing)}
    >
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
                      aria-pressed={open.id === item.id}
                      aria-controls={DRAWER_ID}
                      onClick={() =>
                        setOpen({ id: open.id === item.id ? null : item.id, chosen: true })
                      }
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
