/**
 * What the post-match run asks after the whistle, and in what order (T-1823,
 * D-417). Pure; the job reads the rows and sends the asks.
 *
 * Found on 2026-11-13 (data auditor, then the runs and the detail marks on
 * production, read-only): a match's detail is marked asked
 * (`fixture_detail_fetch`) the first time it is asked after the whistle --
 * usually by the live job when the match leaves the live list (T-830) -- and
 * nothing asked it again. Lower-division cup sides (Copa del Rey, KNVB Beker,
 * the Scottish League Cup) and the Persian Gulf Pro League get their line-ups
 * from the provider hours or days after the match, so those matches kept an
 * empty line-up until 2026-11-10 20:00, when an operator's catalogue adoption
 * cleared every mark (`catalog.mjs`, `askAgainForDetail`) and the backlog asked
 * every match again: the line-ups then arrived 2 to 12 days "late". Beside it,
 * the recent asks were ten a run, newest kick-off first, so on a crowded
 * evening the earlier matches of the window waited behind the later ones.
 *
 * Now each run asks, in this order:
 *
 *   1. recent: finished matches in the live window, `detailBatch` of them
 *      (`INGESTION_DETAIL_BATCH`, 30 unless set), those never asked after the
 *      whistle first, oldest kick-off first, then the one asked longest ago --
 *      fair across competitions (`fairOrder`), never in the order of their
 *      names;
 *   2. the backlog of matches never asked (T-102), as before, fair across
 *      competitions;
 *   3. line-up re-asks: finished matches of the last `LINEUP_REASK_DAYS` still
 *      missing a side's line-up, asked again once `LINEUP_REASK_HOURS` have
 *      passed since the last ask, at most `LINEUP_REASK_BATCH` a run, the one
 *      asked longest ago first, fair across competitions.
 */

/** Recent asks one post-match run sends unless `INGESTION_DETAIL_BATCH` says otherwise. */
export const DETAIL_BATCH = 30;
/** A ceiling on the setting, so a typo cannot spend the reserve in one run. */
export const MAX_DETAIL_BATCH = 100;

/** The recent batch this deployment asked for: a whole number from 1 to 100, else the default. */
export function detailBatch(raw: string | undefined): number {
  const value = Number((raw ?? '').trim());
  return Number.isInteger(value) && value > 0 && value <= MAX_DETAIL_BATCH ? value : DETAIL_BATCH;
}

/**
 * How long after its last ask a finished match still missing a line-up is
 * asked again. Four asks a day: a provider that adds line-ups the next morning
 * is heard within six hours, not twelve days.
 */
export const LINEUP_REASK_HOURS = 6;
/**
 * How long after kick-off a missing line-up is still asked for. The Copa del
 * Rey's of 2026-10-29 were at the provider by 2026-11-10 (12 days); after two
 * weeks a line-up that has not come is taken as not supplied.
 */
export const LINEUP_REASK_DAYS = 14;
/** The most line-up re-asks one run sends (at most 960 a day, about 300 in practice). */
export const LINEUP_REASK_BATCH = 20;

/**
 * Items ordered by `compare` within each competition, then taken one from each
 * competition in turn, so a competition with forty matches on one evening does
 * not hold the others behind it. The competitions take turns in the order of
 * their first item by `compare`, then by id: never by name. Pure.
 */
export function fairOrder<T>(
  items: readonly T[],
  competitionOf: (item: T) => string,
  compare: (a: T, b: T) => number,
): T[] {
  const by = new Map<string, T[]>();
  for (const item of items) {
    const key = competitionOf(item);
    by.set(key, [...(by.get(key) ?? []), item]);
  }
  const queues = [...by.entries()]
    .map(([key, list]) => ({ key, list: [...list].sort(compare) }))
    .sort((a, b) => compare(a.list[0]!, b.list[0]!) || a.key.localeCompare(b.key));
  const out: T[] = [];
  const longest = Math.max(0, ...queues.map((q) => q.list.length));
  for (let round = 0; round < longest; round += 1) {
    for (const queue of queues) {
      const item = queue.list[round];
      if (item !== undefined) out.push(item);
    }
  }
  return out;
}

const time = (iso: string): number => Date.parse(iso);

/** A finished match in the live window, as the store reads it. */
export interface RecentDetail {
  competitionId: string;
  kickoffAt: string;
  /** When its detail was last asked after the whistle; null if never. */
  detailFetchedAt: string | null;
}

/**
 * The recent asks, at most `batch`: the never-asked first, oldest kick-off
 * first; then the asked, the longest ago first (then the older kick-off).
 * Each class fair across competitions. Pure.
 */
export function recentDetailOrder<T extends RecentDetail>(known: readonly T[], batch: number): T[] {
  const never = known.filter((f) => f.detailFetchedAt === null);
  const asked = known.filter((f) => f.detailFetchedAt !== null);
  return [
    ...fairOrder(
      never,
      (f) => f.competitionId,
      (a, b) => time(a.kickoffAt) - time(b.kickoffAt),
    ),
    ...fairOrder(
      asked,
      (f) => f.competitionId,
      (a, b) =>
        time(a.detailFetchedAt ?? a.kickoffAt) - time(b.detailFetchedAt ?? b.kickoffAt) ||
        time(a.kickoffAt) - time(b.kickoffAt),
    ),
  ].slice(0, Math.max(0, batch));
}

/** A finished match still missing a line-up, as the store reads it. */
export interface LineupOwed {
  competitionId: string;
  kickoffAt: string;
  /** When its detail was last asked after the whistle. */
  askedAt: string;
}

/** The line-up re-asks this run sends: the longest-unasked first, fair across competitions. Pure. */
export function lineupReasks<T extends LineupOwed>(owed: readonly T[], batch: number): T[] {
  return fairOrder(
    owed,
    (f) => f.competitionId,
    (a, b) => time(a.askedAt) - time(b.askedAt) || time(a.kickoffAt) - time(b.kickoffAt),
  ).slice(0, Math.max(0, batch));
}
