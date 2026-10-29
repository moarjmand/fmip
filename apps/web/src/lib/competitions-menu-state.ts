import { type ReactNode, useSyncExternalStore } from 'react';
import type { Message } from '@/i18n/messages';

/**
 * The competitions menu's client side (T-1643, D-301): whether it is open,
 * who opened it, and the shape of what it draws. No catalogue, no
 * `@fmip/contracts` and no filtering here: this module rides on every page's
 * first load, and the panel's own code (`competitions-menu-panel.tsx`) is
 * fetched when a reader first points at the trigger.
 *
 * **Opening it from elsewhere.** The header's Competitions button is one
 * opener; any other control can be another (the bar under the header, say):
 *
 *     const open = useCompetitionsMenu();
 *     <button
 *       aria-expanded={open}
 *       aria-controls={COMPETITIONS_MENU_ID}
 *       onClick={(event) => toggleCompetitionsMenu(event.currentTarget)}
 *       onPointerEnter={warmCompetitionsMenu}
 *     >
 *
 * The panel (`CompetitionsMenuPanel`, mounted once in the header) does the
 * rest: it asks for its contents, moves focus into itself, and on Esc, a
 * click on the scrim or a chosen link closes and hands focus back to the
 * control that opened it. It is a desktop panel: below 1024px no control
 * should open it (a phone's Leagues tab leads to the competitions page).
 */

/** The panel's element id, for `aria-controls`. */
export const COMPETITIONS_MENU_ID = 'competitions-menu';

let open = false;
let opener: HTMLElement | null = null;
let warmer: (() => void) | null = null;
const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

export function subscribeCompetitionsMenu(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function competitionsMenuOpen(): boolean {
  return open;
}

/** Opens the menu; `from` is the control focus returns to when it closes. */
export function openCompetitionsMenu(from?: HTMLElement | null): void {
  if (open) return;
  opener =
    from ??
    (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null));
  open = true;
  emit();
}

/**
 * Closes the menu. Focus goes back to its opener unless `restoreFocus` is
 * false: the reader moved focus elsewhere themselves, or the screen
 * narrowed under the panel.
 */
export function closeCompetitionsMenu(restoreFocus = true): void {
  if (!open) return;
  open = false;
  const back = opener;
  opener = null;
  emit();
  if (restoreFocus) back?.focus();
}

export function toggleCompetitionsMenu(from?: HTMLElement | null): void {
  if (open) closeCompetitionsMenu();
  else openCompetitionsMenu(from);
}

/** Starts asking for the menu's contents before it opens: on a hover or a focus of an opener. */
export function warmCompetitionsMenu(): void {
  warmer?.();
}

/** The panel's own: what `warmCompetitionsMenu` calls. Returns the undo. */
export function setCompetitionsMenuWarmer(fn: () => void): () => void {
  warmer = fn;
  return () => {
    if (warmer === fn) warmer = null;
  };
}

/** Whether the menu is open; `false` on the server and while hydrating. */
export function useCompetitionsMenu(): boolean {
  return useSyncExternalStore(subscribeCompetitionsMenu, competitionsMenuOpen, () => false);
}

/** The panel's breakpoint, `lg` (1024px): the header's one row starts there. */
const WIDE = '(min-width: 64rem)';

function subscribeWide(listener: () => void): () => void {
  const query = window.matchMedia(WIDE);
  query.addEventListener('change', listener);
  return () => query.removeEventListener('change', listener);
}

/** Whether the screen is wide enough for the panel; `false` on the server and while hydrating. */
export function useWideScreen(): boolean {
  return useSyncExternalStore(
    subscribeWide,
    () => window.matchMedia(WIDE).matches,
    () => false,
  );
}

// ---------------------------------------------------------------------------
// What the menu draws (built on the server, `components/competitions-menu.tsx`)
// ---------------------------------------------------------------------------

/** Which competitions the toggles show. */
export type MenuShow = 'all' | 'today' | 'live';

export interface MenuRowView {
  id: string;
  /** Its name, short name, country and group as the filter compares them (`foldName`). */
  fold: string;
  live: boolean;
  today: boolean;
  /** The row itself, drawn by the server: a link with the logo, the name and the status. */
  node: ReactNode;
}

export interface MenuGroupView {
  region: string;
  label: Message;
  rows: MenuRowView[];
}

export interface CompetitionsMenuView {
  /** The desktop's columns, each a list of groups; a phone reads them in this order, one under another. */
  columns: MenuGroupView[][];
  /** "2 live now · 6 playing today · 39 in all", or the count alone when today could not be read. */
  counts: Message;
  /** The toggles' words with their counts; `null` when today's matches could not be read (All alone). */
  show: Record<MenuShow, Message> | null;
  /** "N competitions" for every N up to the number listed: what the filter announces. */
  counted: string[];
  /** Every N up to the number listed in the reader's digits: a group's count. */
  numbers: string[];
  noMatch: Message;
  /** "Kick-off times in UK time · days are the next match day". */
  note: Message;
  /**
   * "Last checked 5 sec ago" for today's matches (rule 4), drawn by the
   * server when it drew the list; `null` when today could not be read. The
   * panel asks again every 30 s while it is open, so it moves on.
   */
  stamp: ReactNode;
}
