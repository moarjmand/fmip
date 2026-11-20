'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import Link from '@/components/ui/link';

/** One menu entry: the console path, its link under the base, its Persian label. */
export interface ConsoleNavItem {
  path: string;
  href: string;
  label: string;
  /** The open requests' count in Persian digits beside the link (T-1728), or none. */
  badge?: string | null;
}

/**
 * The console path of a browser path (T-1871): without the base it is served
 * under (D-341) or the `/console` folder the proxy maps it to, so the server's
 * render and the browser's agree whichever of the two they read.
 */
export function consolePathname(pathname: string, base: string): string {
  const under = (prefix: string) => pathname === prefix || pathname.startsWith(`${prefix}/`);
  if (base && under(base)) return pathname.slice(base.length) || '/';
  if (under('/console')) return pathname.slice('/console'.length) || '/';
  return pathname || '/';
}

/** Whether a menu entry is the page shown: the overview only on itself, the others with their sub-pages. */
export function isCurrent(itemPath: string, current: string): boolean {
  if (itemPath === '/') return current === '/';
  return current === itemPath || current.startsWith(`${itemPath}/`);
}

/**
 * Asking for the layout again (T-1906, D-456). Next keeps a layout across a
 * link's navigation, so the heartbeat it was given (the last sync's time, the
 * queue's counts, this menu's badge) would stay that of the first page. It is
 * asked for again once it is ten minutes old, and **only if the person has
 * touched the page since it arrived**: every such request restarts the
 * session's 12-hour idle clock (D-455), and a console left open on a desk
 * must still time out. With no input nothing is asked, ever; the bar ages its
 * own words on the browser's clock (`heartbeat-clock.tsx`), and the first
 * request after the idle limit lands on sign-in as before.
 */
export const LAYOUT_MAX_AGE_MS = 10 * 60_000;

/**
 * What counts as the person being there: touching, typing, turning the wheel.
 * Not `focus` (the system hands a window its focus back by itself, when
 * another program's window closes) and not `scroll` (a page scrolls by itself
 * too): neither proves a person, and either would keep an idle session alive
 * (review of #957, round 2).
 */
export const INPUT_EVENTS = ['pointerdown', 'keydown', 'touchstart', 'wheel'] as const;

/** When the layout's render arrived and when the person last touched the page, on one clock. */
export interface LayoutAge {
  seenAt: number;
  inputAt: number;
}

/**
 * Whether to ask for the layout again: it is old, the person has touched the
 * page since it arrived, and the page is seen and has a network.
 */
export function shouldRefresh(
  age: LayoutAge,
  now: number,
  page: { visible: boolean; online: boolean },
): boolean {
  return (
    page.visible && page.online && now - age.seenAt > LAYOUT_MAX_AGE_MS && age.inputAt > age.seenAt
  );
}

/**
 * The refresh rule with its clock and its page handed in, so it is tested
 * without a browser. `input` is the person touching the page; `tick` is
 * time passing, the tab coming back, or the page changing; `rendered` is a
 * new layout arriving. One ask per age, also when the ask fails.
 */
export function layoutRefresher(page: {
  refresh: () => void;
  now: () => number;
  visible: () => boolean;
  online: () => boolean;
}) {
  const age: LayoutAge = { seenAt: page.now(), inputAt: Number.NEGATIVE_INFINITY };
  const check = () => {
    const now = page.now();
    if (!shouldRefresh(age, now, { visible: page.visible(), online: page.online() })) return;
    age.seenAt = now;
    page.refresh();
  };
  return {
    rendered() {
      age.seenAt = page.now();
    },
    input() {
      age.inputAt = page.now();
      check();
    },
    tick: check,
  };
}

/** The width from which the menu is a column (Tailwind's `lg`, `.console-menu` in globals.css). */
const WIDE = '(width >= 64rem)';

/**
 * The console's menu (T-1871). Below 1024px a `<details>`: its «فهرست»
 * summary opens the list as a panel that scrolls, with or without
 * JavaScript, since the links are in the server's HTML. From 1024px the
 * `<details>` is no box at all (`.console-menu` in globals.css) and the list
 * is a column at the inline-start edge (the right, in Persian) that scrolls
 * by itself; a browser that cannot style a closed `<details>` keeps the
 * summary there instead. The page shown is marked `aria-current="page"`.
 */
export function ConsoleNav({
  items,
  base,
  renderedAt,
}: {
  items: readonly ConsoleNavItem[];
  base: string;
  /** When the server drew the layout; a new value means a new render arrived. */
  renderedAt?: number;
}) {
  const [open, setOpen] = useState(false);
  const summary = useRef<HTMLElement>(null);
  const current = consolePathname(usePathname() ?? '/', base);
  const router = useRouter();

  // T-1906: the layout is asked for again once it is old, and only after the
  // person has touched the page (`layoutRefresher`). Times are this browser's,
  // counted from when the render arrived, never against the server's clock.
  const refresher = useRef<ReturnType<typeof layoutRefresher> | null>(null);
  useEffect(() => {
    const made = layoutRefresher({
      refresh: () => router.refresh(),
      now: () => Date.now(),
      visible: () => document.visibilityState === 'visible',
      online: () => navigator.onLine,
    });
    refresher.current = made;
    const listening = { capture: true, passive: true } as const;
    for (const name of INPUT_EVENTS) window.addEventListener(name, made.input, listening);
    document.addEventListener('visibilitychange', made.tick);
    const timer = window.setInterval(made.tick, 60_000);
    return () => {
      for (const name of INPUT_EVENTS) window.removeEventListener(name, made.input, listening);
      document.removeEventListener('visibilitychange', made.tick);
      window.clearInterval(timer);
      refresher.current = null;
    };
  }, [router]);
  useEffect(() => {
    refresher.current?.rendered();
  }, [renderedAt]);
  useEffect(() => {
    refresher.current?.tick();
  }, [current]);

  // A panel opened on a phone is closed when the window grows into the column.
  useEffect(() => {
    const wide = window.matchMedia(WIDE);
    const close = () => {
      if (wide.matches) setOpen(false);
    };
    wide.addEventListener('change', close);
    return () => wide.removeEventListener('change', close);
  }, []);

  // Escape from the summary or a link closes the panel, and focus goes back
  // to the summary, but only while the summary is shown.
  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    const shown = summary.current !== null && summary.current.getClientRects().length > 0;
    if (!shown) return;
    event.preventDefault();
    setOpen(false);
    summary.current?.focus();
  };

  return (
    <nav
      aria-label="منوی کنسول"
      className="order-last basis-full lg:order-none lg:min-h-0 lg:flex-1 lg:basis-auto lg:overflow-y-auto lg:px-3"
    >
      <details
        open={open}
        onToggle={(event) => setOpen(event.currentTarget.open)}
        onKeyDown={closeOnEscape}
        className="console-menu group"
      >
        <summary
          ref={summary}
          className="inline-flex min-h-touch min-w-touch cursor-pointer list-none items-center justify-center gap-2 rounded-control border border-strong px-3 text-sm text-fg [&::-webkit-details-marker]:hidden"
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 20 20"
            className="size-4"
            fill="none"
            stroke="currentColor"
          >
            <path
              className="group-open:hidden"
              d="M3 5h14M3 10h14M3 15h14"
              strokeWidth="2"
              strokeLinecap="round"
            />
            <path
              className="hidden group-open:block"
              d="M5 5l10 10M15 5L5 15"
              strokeWidth="2"
              strokeLinecap="round"
            />
          </svg>
          فهرست
        </summary>
        <ul className="mt-2 flex max-h-[60dvh] flex-col gap-0.5 overflow-y-auto overscroll-contain border-t border-default py-2 lg:mt-0 lg:max-h-none lg:overflow-visible lg:border-t-0 lg:pt-0">
          {items.map((item) => {
            const here = isCurrent(item.path, current);
            return (
              <li key={item.path}>
                <Link
                  href={item.href}
                  aria-current={here ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className="flex min-h-touch items-center gap-2 rounded-control border-s-2 border-transparent px-3 text-sm text-muted hover:bg-surface-raised hover:text-fg aria-[current=page]:border-brand aria-[current=page]:bg-surface-raised aria-[current=page]:font-bold aria-[current=page]:text-fg"
                >
                  <span className="min-w-0 flex-1">{item.label}</span>
                  {item.badge && (
                    <span className="rounded-pill bg-brand px-1.5 text-xs font-bold text-on-brand">
                      {item.badge}
                      <span className="sr-only"> درخواست باز</span>
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </details>
    </nav>
  );
}
