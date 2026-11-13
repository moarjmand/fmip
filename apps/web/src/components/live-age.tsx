'use client';

import { createContext, useContext } from 'react';
import { FreshnessStamp, type FreshnessWords } from '@/components/freshness-stamp';

/**
 * The live page's clock, for the modules the server draws (T-1811, D-409
 * point 4). The match centre's moving modules are server markup handed in
 * through slots and drawn again only when the stream says they changed; an
 * age printed in that markup would stand still between two calls. A module
 * puts `LiveAge` where its age goes instead: a small client island that
 * reads `LiveMatch`'s clock from this context and ticks with it, so "Stats
 * updated 2 min ago" (T-1782) keeps moving and turns amber past its
 * threshold (rule 4) though the card around it is server markup.
 */
export interface LiveClock {
  /** The page's clock, ms since the epoch; `undefined` outside a live match page. */
  now: number | undefined;
  /**
   * A change the server modules read was seen more than a minute ago and is
   * not drawn yet: a call failed or is late (`modulesBehind`).
   */
  behind: boolean;
}

const LiveClockContext = createContext<LiveClock>({ now: undefined, behind: false });

/** Given by `LiveMatch` around the match centre. */
export const LiveClockProvider = LiveClockContext.Provider;

export function useLiveClock(): LiveClock {
  return useContext(LiveClockContext);
}

/**
 * A server module's age on the live clock: `FreshnessStamp` with the page's
 * `now`. Outside a live page there is no clock and it draws nothing, as the
 * stamp does on a server render without one.
 */
export function LiveAge({
  checkedAt,
  staleAfterMs,
  locale,
  words,
  testId,
  className,
  followsModules = false,
}: {
  checkedAt: number | string;
  staleAfterMs: number;
  locale: string;
  words: FreshnessWords;
  testId?: string;
  className?: string;
  /**
   * The age of a module the stream draws again (D-409): also in its "may be
   * behind" state while the page's server modules are behind the stream (a
   * call failed), in the stamp's own words -- never a line of its own.
   */
  followsModules?: boolean;
}) {
  const { now, behind } = useLiveClock();
  return (
    <FreshnessStamp
      checkedAt={checkedAt}
      now={now}
      staleAfterMs={staleAfterMs}
      behind={followsModules && behind}
      locale={locale}
      words={words}
      testId={testId}
      className={className}
    />
  );
}
