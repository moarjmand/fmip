import type { MatchCentre } from '@fmip/contracts';

/**
 * When the match centre's server-drawn modules are drawn again in play
 * (T-1810, D-409). Pure: the clock and the dice are the caller's, so every
 * rule here is unit-tested and the client component only feeds it readings.
 *
 * The stream sends a snapshot on every write (debounced 300 ms): once a
 * minute for the clock and the score, every three minutes for the
 * statistics (D-382), and on every event. The server modules do not show the
 * clock, so a snapshot that moved only the clock asks for nothing. An event
 * is drawn within a few seconds; a statistics-only change within fifteen,
 * which the three-minute cadence makes invisible; each with a random delay,
 * so a thousand readers of one match do not all ask in the same second.
 * Never two calls in flight: a change that arrives meanwhile is one more
 * call when the first settles.
 */

/** What the server modules are drawn from, without the clock. */
export interface LiveSignature {
  /** The events as recorded, the periods, and the extra-time and shoot-out scores. */
  events: string;
  /** When the statistics, player statistics, expected goals and line-up were last written. */
  stats: string;
}

export type LivePart = keyof LiveSignature;

/** What moved between two snapshots, as far as the server modules are concerned. */
export type LiveChange = 'event' | 'stats';

/**
 * The signature of a snapshot. The minute, the score and the status are not
 * in it: the band draws the first two at once from the snapshot, and a status
 * change draws the whole page again (D-409 point 3).
 */
export function liveSignature(centre: MatchCentre): LiveSignature {
  const f = centre.fixture;
  return {
    events: JSON.stringify([
      centre.timeline.coverage,
      centre.timeline.data,
      f.periods,
      f.scores.extra_time,
      f.scores.penalties,
    ]),
    stats: [
      centre.statistics,
      centre.player_statistics,
      centre.player_expected_goals,
      centre.lineups,
    ]
      .map((module) => `${module.coverage}@${module.last_updated_at ?? ''}`)
      .join('|'),
  };
}

/**
 * What changed between what the modules on screen were drawn from and the
 * newest snapshot, among the parts those modules read: an event before a
 * statistics change, since it is drawn sooner. `null`: nothing to draw.
 */
export function liveChange(
  drawn: LiveSignature,
  latest: LiveSignature,
  parts: readonly LivePart[],
): LiveChange | null {
  if (parts.includes('events') && drawn.events !== latest.events) return 'event';
  if (parts.includes('stats') && drawn.stats !== latest.stats) return 'stats';
  return null;
}

/** The longest random wait before an event is drawn. */
export const EVENT_WINDOW_MS = 3_000;
/** The longest random wait before a statistics-only change is drawn. */
export const STATS_WINDOW_MS = 15_000;
/**
 * In lite mode (T-1387) a statistics-only change waits for the next event, or
 * this long: a reader on a metered phone is not sent every three-minute tick.
 */
export const LITE_STATS_WAIT_MS = 6 * 60_000;
/** A change not drawn after this long means the modules may be behind. */
export const BEHIND_AFTER_MS = 60_000;

/**
 * Why a call is planned: a change seen in a snapshot, or the stream opening
 * again after a break (when a deploy has also replaced the server function,
 * which only a call finds out).
 */
export type RefreshReason = LiveChange | 'reopen';

/** The refresh's state: when the next call is due, and whether one is in flight. */
export interface RefreshPlan {
  /** When the next call is due, ms since the epoch; `null` when none is. */
  due: number | null;
  inFlight: boolean;
  /** A call came due while one was in flight: one more as soon as it settles. */
  trailing: boolean;
}

export const NO_REFRESH: RefreshPlan = { due: null, inFlight: false, trailing: false };

/**
 * When a call for this reason goes: an event within `EVENT_WINDOW_MS`, a
 * statistics change or a reopened stream within `STATS_WINDOW_MS` (a
 * reopen after a deploy is every reader at once), in lite mode a
 * statistics change after `LITE_STATS_WAIT_MS`. A call already due sooner
 * stays as it is, so a later change never delays an earlier one, and an
 * event brings a held statistics change forward with it. `random` is in
 * [0, 1).
 */
export function planRefresh(
  plan: RefreshPlan,
  reason: RefreshReason,
  { now, random, lite }: { now: number; random: number; lite: boolean },
): RefreshPlan {
  const at =
    lite && reason === 'stats'
      ? now + LITE_STATS_WAIT_MS
      : now + Math.floor(random * (reason === 'event' ? EVENT_WINDOW_MS : STATS_WINDOW_MS));
  return { ...plan, due: plan.due === null ? at : Math.min(plan.due, at) };
}

/**
 * The due time has come: call now, or -- with one in flight -- once it
 * settles (the trailing call). Nothing before the due time.
 */
export function refreshDue(plan: RefreshPlan, now: number): { plan: RefreshPlan; call: boolean } {
  if (plan.due === null || now < plan.due) return { plan, call: false };
  if (plan.inFlight) return { plan: { ...plan, due: null, trailing: true }, call: false };
  return { plan: { due: null, inFlight: false, trailing: false }, call: true };
}

/** A call starts. */
export function refreshStarted(plan: RefreshPlan): RefreshPlan {
  return { ...plan, inFlight: true };
}

/**
 * A call settled, drawn or failed: the trailing call goes at once (its wait
 * has passed); a due time still ahead stays for its timer.
 */
export function refreshSettled(plan: RefreshPlan): { plan: RefreshPlan; call: boolean } {
  if (plan.trailing)
    return { plan: { due: plan.due, inFlight: false, trailing: false }, call: true };
  return { plan: { ...plan, inFlight: false }, call: false };
}

/**
 * Whether the server modules may be behind (D-409 point 4): a change they
 * read was seen more than `BEHIND_AFTER_MS` ago and is still not drawn -- a
 * call failed, or is very late. `waitingSince` is when that change was first
 * seen; `null` when the modules show the newest snapshot.
 */
export function modulesBehind(waitingSince: number | null, now: number): boolean {
  return waitingSince !== null && now - waitingSince > BEHIND_AFTER_MS;
}
