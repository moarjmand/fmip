/**
 * Which matches the line-ups job asks for their line-up, and in what order
 * (T-1625, D-293).
 *
 * The job used to ask the first ten scheduled or live matches kicking off from
 * 210 minutes ago to 30 minutes ahead, in the order of the polled competitions,
 * whether or not their line-ups were already stored. On a busy evening the ten
 * were matches already playing, or cup ties whose line-up the provider never
 * sends, and a Serie A or Champions League match kicking off a few minutes
 * later was never asked: its line-up arrived with the post-match detail, about
 * two hours after kick-off (35 of 92 big-league matches, 2026-10-18 to 27).
 * The matches that were asked in time had their line-up on the first ask, at
 * 25 to 30 minutes before kick-off, so the provider held it before we asked.
 *
 * Now a match is asked from `LINEUP_ASK_FROM_MINUTES` before kick-off, every
 * run (five minutes), and by need:
 *
 * 1. no line-up stored yet and not kicked off, the soonest first;
 * 2. no line-up stored yet and kicked off within `LINEUP_ASK_UNTIL_MINUTES`,
 *    the soonest first: some providers publish a cup tie's line-up after the
 *    whistle, and the post-match detail fills it at full time anyway;
 * 3. a line-up stored and not kicked off, to catch a late change, the
 *    soonest first.
 *
 * at most `LINEUP_BATCH` a run. A match already playing whose line-up is
 * stored is not asked: what changes in play are incidents, which the live job
 * reads, and the post-match detail writes the line-up again at full time.
 */

/** How long before kick-off a match's line-up is first asked for. */
export const LINEUP_ASK_FROM_MINUTES = 75;
/** How long after kick-off a line-up that never came is still asked for. */
export const LINEUP_ASK_UNTIL_MINUTES = 60;
/** How many line-up asks one run sends at most. */
export const LINEUP_BATCH = 30;

/** A polled match near kick-off, as the store reads it. */
export interface LineupCandidate {
  externalId: string;
  fixtureId: string;
  kickoffAt: string;
  status: string;
  /** Both sides' line-ups are stored. One side alone is not the line-ups. */
  announced: boolean;
}

/** The span of kick-offs the store reads candidates from: `(from, to]`. */
export function lineupWindow(now: Date): { from: string; to: string } {
  const minute = 60 * 1000;
  return {
    from: new Date(now.getTime() - LINEUP_ASK_UNTIL_MINUTES * minute).toISOString(),
    to: new Date(now.getTime() + LINEUP_ASK_FROM_MINUTES * minute).toISOString(),
  };
}

/** The matches to ask this run, in the order to ask them. Pure. */
export function lineupAsks(candidates: LineupCandidate[], now: Date): LineupCandidate[] {
  const { from, to } = lineupWindow(now);
  const start = Date.parse(from);
  const end = Date.parse(to);
  const at = now.getTime();
  const rank = (c: LineupCandidate): number | null => {
    const kickoff = Date.parse(c.kickoffAt);
    if (Number.isNaN(kickoff) || kickoff <= start || kickoff > end) return null;
    if (c.status !== 'scheduled' && c.status !== 'live') return null;
    const started = kickoff <= at || c.status === 'live';
    if (!c.announced) return started ? 1 : 0;
    return started ? null : 2;
  };
  return candidates
    .map((c) => ({ c, rank: rank(c) }))
    .filter((r): r is { c: LineupCandidate; rank: number } => r.rank !== null)
    .sort(
      (a, b) =>
        a.rank - b.rank ||
        Date.parse(a.c.kickoffAt) - Date.parse(b.c.kickoffAt) ||
        a.c.fixtureId.localeCompare(b.c.fixtureId),
    )
    .slice(0, LINEUP_BATCH)
    .map((r) => r.c);
}
