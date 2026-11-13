'use client';

import { createContext, useContext } from 'react';
import { FreshnessStamp, type FreshnessWords } from '@/components/freshness-stamp';
import type { LivePart, PerPart } from '@/lib/live-modules';

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
   * Per part of the stream (`events`, `stats`): a change the server modules
   * reading it read was seen more than a minute ago and is not drawn yet --
   * a call failed or is late (`modulesBehind`).
   */
  behind: PerPart<boolean>;
  /** Per part: when the modules reading it were last drawn, on the page's clock. */
  drawnAt: PerPart<number> | undefined;
}

const LiveClockContext = createContext<LiveClock>({
  now: undefined,
  behind: { events: false, stats: false },
  drawnAt: undefined,
});

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
  followsModules,
}: {
  checkedAt: number | string;
  staleAfterMs: number;
  locale: string;
  words: FreshnessWords;
  testId?: string;
  className?: string;
  /**
   * The age of a module the stream draws again (D-409), by the part it reads:
   * also in its "may be behind" state while that part is behind the stream (a
   * call failed), in the stamp's own words -- never a line of its own.
   */
  followsModules?: LivePart;
}) {
  const { now, behind } = useLiveClock();
  return (
    <FreshnessStamp
      checkedAt={checkedAt}
      now={now}
      staleAfterMs={staleAfterMs}
      behind={followsModules !== undefined && behind[followsModules]}
      locale={locale}
      words={words}
      testId={testId}
      className={className}
    />
  );
}

/**
 * A server card's "may be behind" line (review B1; the designer's option A,
 * 2026-11-13): nothing while the card is as current as the stream; once a
 * change it reads has waited more than a minute undrawn, `FreshnessStamp` in
 * its behind state -- "▲ Key events updated 3 min ago · may be behind" -- its
 * age the time the card was last drawn. The threshold is the page's (one
 * truth), so the stamp's own is never reached. Gone at the next drawing; no
 * `role` and no live region: the page's polite region has said the change.
 */
export function LiveBehind({
  part,
  locale,
  words,
  testId,
  className,
}: {
  part: LivePart;
  locale: string;
  words: FreshnessWords;
  testId?: string;
  className?: string;
}) {
  const { now, behind, drawnAt } = useLiveClock();
  if (!behind[part] || drawnAt === undefined) return null;
  return (
    <FreshnessStamp
      checkedAt={drawnAt[part]}
      now={now}
      staleAfterMs={Number.POSITIVE_INFINITY}
      behind
      locale={locale}
      words={words}
      testId={testId}
      className={className}
    />
  );
}
