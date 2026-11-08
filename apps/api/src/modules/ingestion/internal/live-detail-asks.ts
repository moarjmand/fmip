/**
 * Which matches in play the live job asks for their whole detail -- team
 * statistics, incidents, line-ups, player statistics -- and when (T-1782,
 * D-382).
 *
 * The provider's live list carries the score, the clock and the events, not
 * the statistics. Until now the only ask that brought a match's statistics
 * during play was the post-match run, every 30 minutes, for the first ten
 * (`DETAIL_BATCH`) live or recently finished matches in the alphabetical order
 * of the polled competitions. On Saturday 2026-11-07 about sixty matches were
 * live or just over at 15:30 and 16:00 UTC, and the Premier League's and La
 * Liga's sat 54th to 62nd: Arsenal v Hull, Fulham v Newcastle, Nottingham
 * Forest v Manchester City and Osasuna v Athletic got no statistic until the
 * whistle, and the matches that did (Leeds v Tottenham at 12:30, Valencia v
 * Real Madrid at 20:00) moved every half hour at best.
 *
 * Now the live job, after the live list, asks each match the list says is in
 * play for its detail at most once every `minutes` (`INGESTION_LIVE_DETAIL_MINUTES`,
 * 3 unless set, 0 off), a match never asked first, then the one asked longest
 * ago, at most `LIVE_DETAIL_PER_TICK` a tick, so a crowded Saturday spreads
 * its asks instead of dropping a league. The tick sends the list's alerts
 * first, starts no ask after `LIVE_DETAIL_DEADLINE_MS`, and stops asking at
 * the standard tier's share of the day (`liveDetailBudgetLeft`). An answer
 * about a match in play writes its statistics, periods, line-up and player
 * statistics, never its score, clock or state, which are the list's.
 */

/** The default minutes between two asks about the same match in play. */
export const LIVE_DETAIL_MINUTES = 3;
/** A ceiling on the setting: beyond it a match's statistics move too seldom to call live. */
export const MAX_LIVE_DETAIL_MINUTES = 30;
/**
 * The most detail asks one live tick sends. Sixty-two matches were in play at
 * once at the busiest minute of 2026-11-01..07; at fifteen a tick each is
 * still asked every four to five minutes, and the tick stays well inside its
 * minute (an ask and its writes took about 0.7 s in the post-match runs).
 */
export const LIVE_DETAIL_PER_TICK = 15;
/**
 * No new detail ask starts once this much of a live tick has gone. The tick
 * runs on the one ingestion worker, and the jobs that share it are held to
 * 30 seconds so the next live tick waits that long at most; the asks left over
 * are the longest-waiting on the next tick.
 */
export const LIVE_DETAIL_DEADLINE_MS = 20_000;
/** How long an ask is remembered; a match is over well within it. */
const FORGET_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * The minutes between two asks this deployment set: a whole number from 0
 * (off) to `MAX_LIVE_DETAIL_MINUTES`, else the default.
 */
export function liveDetailMinutes(raw: string | undefined): number {
  const text = (raw ?? '').trim();
  if (text === '') return LIVE_DETAIL_MINUTES;
  const value = Number(text);
  return Number.isInteger(value) && value >= 0 && value <= MAX_LIVE_DETAIL_MINUTES
    ? value
    : LIVE_DETAIL_MINUTES;
}

/** A match the live list answered as in play this tick. */
export interface InPlayMatch {
  fixtureId: string;
  externalId: string;
  kickoffAt: string;
}

/**
 * The matches to ask this tick, in the order to ask them. Pure: `askedAt` is
 * read, never written (the caller records each ask it sends).
 */
export function liveDetailAsks<T extends InPlayMatch>(
  inPlay: T[],
  askedAt: ReadonlyMap<string, number>,
  now: Date,
  minutes: number,
  perTick: number = LIVE_DETAIL_PER_TICK,
): T[] {
  if (minutes <= 0 || perTick <= 0) return [];
  const due = now.getTime() - minutes * 60 * 1000;
  const seen = new Set<string>();
  const out: { match: T; last: number }[] = [];
  for (const match of inPlay) {
    if (seen.has(match.fixtureId)) continue;
    seen.add(match.fixtureId);
    const last = askedAt.get(match.fixtureId);
    if (last !== undefined && last > due) continue;
    out.push({ match, last: last ?? Number.NEGATIVE_INFINITY });
  }
  // Never asked first, then the longest ago; between equals the earlier
  // kick-off, whose statistics have had longest to go without.
  out.sort(
    (a, b) =>
      a.last - b.last ||
      Date.parse(a.match.kickoffAt) - Date.parse(b.match.kickoffAt) ||
      a.match.fixtureId.localeCompare(b.match.fixtureId),
  );
  return out.slice(0, perTick).map((o) => o.match);
}

/**
 * How many detail asks the standard tier still allows today: its ceiling
 * (`tierCeiling`) less the requests the day's runs recorded. `null` is no
 * budget of our own (the replay source, a test): no limit here.
 */
export function liveDetailBudgetLeft(ceiling: number | null, requestsToday: number): number {
  if (ceiling === null) return Number.POSITIVE_INFINITY;
  return Math.max(0, ceiling - requestsToday);
}

/** A polled match near now, as the store reads it. */
export interface RecentFixture {
  externalId: string;
  fixtureId: string;
  status: string;
  kickoffAt: string;
}

/**
 * The post-match run's recent asks, at most `batch` (T-1782). While the live
 * job asks the matches in play (`liveDetailOn`), the finished ones only, the
 * newest kick-off first whatever the competition: the competitions come in
 * alphabetical order, and the first ten of that order left the Premier
 * League out on a busy Saturday. With it off, live and finished matches in
 * the order given, exactly as before T-1782.
 */
export function recentDetailCandidates<T extends RecentFixture>(
  known: T[],
  liveDetailOn: boolean,
  batch: number,
): T[] {
  if (!liveDetailOn) {
    return known.filter((f) => f.status === 'finished' || f.status === 'live').slice(0, batch);
  }
  return known
    .filter((f) => f.status === 'finished')
    .map((f, i) => ({ f, i }))
    .sort((a, b) => Date.parse(b.f.kickoffAt) - Date.parse(a.f.kickoffAt) || a.i - b.i)
    .slice(0, batch)
    .map(({ f }) => f);
}

/** Drops the asks old enough that their match is over; the map is the job's memory. */
export function forgetOldAsks(askedAt: Map<string, number>, now: Date): void {
  for (const [fixtureId, at] of askedAt) {
    if (now.getTime() - at > FORGET_AFTER_MS) askedAt.delete(fixtureId);
  }
}
