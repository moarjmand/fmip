/**
 * "A match on this page just moved" (T-1635, D-297): the match centre and
 * the scores page hear a goal, a card or a new status over their own stream
 * before anything else on the page does. They say so on `window`, and the
 * matchday rail, which asks for its own answer every half-minute, asks at
 * once instead, so the bar over the page never keeps the score from before
 * the goal the page below it shows.
 *
 * An event rather than shared state: the rail is in the locale layout and
 * the live surfaces are in the page, two trees with nothing in common but
 * the window. Nothing is carried with it; the rail's answer is the server's.
 */
export const LIVE_MOVED = 'fmip:live-moved';

/**
 * How often the rail asks for itself again while a match today is being
 * played (`railAskIn` is 0). Here rather than in `lib/matchday-rail.ts`,
 * which reaches the contracts package, because the rail's client half reads
 * it. Lite mode asks once a minute (`LITE_POLL_MS`), as its streams do.
 */
export const RAIL_POLL_MS = 30_000;

export function signalLiveMoved(): void {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(LIVE_MOVED));
}
