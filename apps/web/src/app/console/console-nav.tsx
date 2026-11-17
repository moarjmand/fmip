'use client';

import { usePathname } from 'next/navigation';
import { useId, useRef, useState, type KeyboardEvent } from 'react';
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
 * The console's menu (T-1871): from 1024px a column at the inline-start edge
 * (the right, in Persian) that scrolls by itself; below that a button that
 * opens the same list as a panel that scrolls. The page shown is marked
 * `aria-current="page"`.
 */
export function ConsoleNav({ items, base }: { items: readonly ConsoleNavItem[]; base: string }) {
  const [open, setOpen] = useState(false);
  const toggle = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = consolePathname(usePathname() ?? '/', base);

  const closeOnEscape = (event: KeyboardEvent) => {
    if (event.key !== 'Escape' || !open) return;
    setOpen(false);
    toggle.current?.focus();
  };

  return (
    <>
      <button
        ref={toggle}
        type="button"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((was) => !was)}
        className="inline-flex min-h-touch min-w-touch items-center justify-center gap-2 rounded-control border border-strong px-3 text-sm text-fg lg:hidden"
      >
        <svg aria-hidden="true" viewBox="0 0 20 20" className="size-4 fill-none stroke-current">
          {open ? (
            <path d="M5 5l10 10M15 5L5 15" strokeWidth="2" strokeLinecap="round" />
          ) : (
            <path d="M3 5h14M3 10h14M3 15h14" strokeWidth="2" strokeLinecap="round" />
          )}
        </svg>
        فهرست
      </button>
      <nav
        id={listId}
        aria-label="منوی کنسول"
        onKeyDown={closeOnEscape}
        className={`${open ? 'block' : 'hidden'} order-last max-h-[60dvh] basis-full overflow-y-auto overscroll-contain border-t border-default pt-2 lg:order-none lg:block lg:max-h-none lg:min-h-0 lg:flex-1 lg:basis-auto lg:border-t-0 lg:px-3 lg:pt-0`}
      >
        <ul className="flex flex-col gap-0.5 pb-2">
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
      </nav>
    </>
  );
}
