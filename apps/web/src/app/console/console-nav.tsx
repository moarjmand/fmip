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
 * How old the layout's render may get before it is asked for again (T-1906).
 * Next keeps a layout across a link's navigation and while a page stays open,
 * so the heartbeat bar it drew would go on saying "fresh" from the first
 * page's clock (rule 4). Ten minutes against limits counted in hours.
 */
export const LAYOUT_MAX_AGE_MS = 10 * 60_000;
export const layoutIsOld = (seenAt: number, now: number): boolean =>
  now - seenAt > LAYOUT_MAX_AGE_MS;

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

  // T-1906: the layout (the heartbeat bar, this menu's count) is asked for
  // again once it is old: on a navigation, on coming back to the tab, and
  // each minute a visible page stays open. The age is counted on this
  // browser's clock from when the render arrived, never against the server's.
  const seenAt = useRef(0);
  useEffect(() => {
    seenAt.current = Date.now();
  }, [renderedAt]);
  useEffect(() => {
    const check = () => {
      if (document.visibilityState !== 'visible' || !navigator.onLine) return;
      if (!layoutIsOld(seenAt.current, Date.now())) return;
      seenAt.current = Date.now(); // one ask per age, also when it fails
      router.refresh();
    };
    check();
    document.addEventListener('visibilitychange', check);
    const timer = window.setInterval(check, 60_000);
    return () => {
      document.removeEventListener('visibilitychange', check);
      window.clearInterval(timer);
    };
  }, [current, router]);

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
