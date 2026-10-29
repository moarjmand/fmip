'use client';

import { type ReactNode, Suspense, lazy, useEffect, useState } from 'react';
import type { MenuFrameWords } from '@/components/competitions-menu-panel';
import { MessageText } from '@/components/message-text';
import Link from '@/components/ui/link';
import {
  COMPETITIONS_MENU_ID,
  closeCompetitionsMenu,
  setCompetitionsMenuWarmer,
  toggleCompetitionsMenu,
  useCompetitionsMenu,
  useWideScreen,
  warmCompetitionsMenu,
} from '@/lib/competitions-menu-state';

/**
 * The competitions menu in the header (T-1643, D-301): the nav's
 * Competitions trigger and the panel's shell, the only parts on every page's
 * first load (D-264). The panel's own code -- asking for the list, focus,
 * the filter and the toggles -- is in `competitions-menu-panel.tsx`, fetched
 * the first time a reader points at, focuses or opens the trigger.
 */

const Panel = lazy(() => import('@/components/competitions-menu-panel'));

/**
 * The header's Competitions entry. Without a script, and below 1024px (in
 * the phone's Menu), it is the link to the competitions page it always was;
 * from 1024px with a script it is the button that opens the panel
 * (`aria-expanded`, `aria-controls`), current on the same pages the link is.
 * A hover or a focus starts loading the panel and its list. The moments
 * rail's Leagues (T-1642, D-300) is the same entry in its own looks
 * (`className`, `testId`).
 */
export function CompetitionsMenuTrigger({
  href,
  current,
  className = 'nav-entry',
  testId = 'nav-competitions',
  children,
}: {
  href: string;
  current: boolean;
  className?: string;
  testId?: string;
  children: ReactNode;
}) {
  const wide = useWideScreen();
  const open = useCompetitionsMenu();
  if (!wide) {
    return (
      <Link
        href={href}
        aria-current={current ? 'page' : undefined}
        data-testid={testId}
        className={className}
      >
        {children}
      </Link>
    );
  }
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={COMPETITIONS_MENU_ID}
      aria-current={current ? 'page' : undefined}
      data-testid={testId}
      className={`${className} cursor-pointer`}
      onPointerEnter={warmCompetitionsMenu}
      onFocus={warmCompetitionsMenu}
      onClick={(event) => {
        // More, if open beside it, closes: one panel at a time under the bar.
        event.currentTarget.closest('ul')?.querySelector('details[open]')?.removeAttribute('open');
        toggleCompetitionsMenu(event.currentTarget);
      }}
    >
      {children}
    </button>
  );
}

/**
 * The panel's place under the header, from 1024px: the element the trigger
 * controls, hidden until it opens. Its contents are drawn once a reader has
 * pointed at, focused or opened the trigger; a screen that narrows under an
 * open panel closes it, since there is no panel below 1024px.
 */
export function CompetitionsMenuPanel({
  locale,
  timeZone,
  words,
}: {
  locale: string;
  timeZone: string;
  words: MenuFrameWords;
}) {
  const open = useCompetitionsMenu();
  const wide = useWideScreen();
  const [warm, setWarm] = useState(false);
  useEffect(() => setCompetitionsMenuWarmer(() => setWarm(true)), []);
  useEffect(() => {
    if (open && !wide) closeCompetitionsMenu(false);
  }, [open, wide]);

  const shown = open && wide;
  return (
    <div id={COMPETITIONS_MENU_ID} hidden={!shown} className="max-lg:hidden">
      {warm || open ? (
        <Suspense
          fallback={
            <div className="menu-panel">
              <p className="page-frame py-5 text-sm text-muted">
                <MessageText message={words.loading} />
              </p>
            </div>
          }
        >
          <Panel locale={locale} timeZone={timeZone} words={words} open={shown} />
        </Suspense>
      ) : null}
    </div>
  );
}
