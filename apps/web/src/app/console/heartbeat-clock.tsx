'use client';

import { useEffect, useState } from 'react';
import type { ConsoleHeartbeat } from '@fmip/contracts';
import { PcHeartbeat, freshness, syncSentence } from './ui';

/**
 * The heartbeat bar's clock (T-1906, D-456). The server words the bar once,
 * from the time the last sync arrived; from then on the browser ages it by
 * itself: "two hours ago" becomes three, fresh becomes late and late becomes
 * silent, with no request. So a page left open stays true (rule 4) without
 * keeping its session alive: nothing here touches the server, and an idle
 * console still ends after its 12 hours (D-455).
 */

/**
 * The server's clock now: the instant the page was rendered plus the time
 * that has passed in this browser since it arrived. Only elapsed time is read
 * from the browser, so a browser clock set wrong changes nothing.
 */
export const agedClock = (renderedAt: number, arrivedAt: number, browserNow: number): number =>
  renderedAt + Math.max(0, browserNow - arrivedAt);

/** How often the bar looks at the clock: its words change by the minute. */
const TICK_MS = 30_000;

function useServerClock(renderedAt: number): number {
  const [now, setNow] = useState(renderedAt);
  useEffect(() => {
    const arrivedAt = Date.now();
    const tick = () => setNow(agedClock(renderedAt, arrivedAt, Date.now()));
    const timer = window.setInterval(tick, TICK_MS);
    // A hidden tab's timers are slowed; the bar catches up the moment it is seen.
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [renderedAt]);
  // A new render (a navigation, a form) carries a later instant than the last tick knew.
  return Math.max(now, renderedAt);
}

/** `PcHeartbeat`, aged by the clock: first exactly as the server drew it. */
export function LiveHeartbeat({
  heartbeat,
  renderedAt,
  compact = false,
}: {
  heartbeat: ConsoleHeartbeat | null;
  /** The server's clock when it rendered the page, in milliseconds. */
  renderedAt: number;
  compact?: boolean;
}) {
  const now = useServerClock(renderedAt);
  return <PcHeartbeat heartbeat={heartbeat} now={new Date(now)} compact={compact} />;
}

/** The sentence above an agent's controls, whose "next" time passes like any other. */
export function LiveSyncSentence({
  heartbeat,
  renderedAt,
}: {
  heartbeat: ConsoleHeartbeat | null;
  renderedAt: number;
}) {
  const now = useServerClock(renderedAt);
  return heartbeat === null
    ? 'هر دستور در صف می‌ماند تا رایانه آن را بردارد.'
    : syncSentence(freshness(heartbeat.loaded_at, new Date(now)));
}
