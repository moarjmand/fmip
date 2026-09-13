import type { Prediction, PredictionHistoryFixture, PredictionHistoryItem } from '@fmip/contracts';

/**
 * Comparing two members' prediction records (blueprint 8.1, T-203).
 *
 * Pure, so the counting rules are argued with in a unit test rather than
 * inspected on a page. Every rule here exists because the obvious version of
 * this feature overstates what it knows.
 */

/**
 * How many of each member's predictions the comparison can see.
 *
 * `HISTORY_MAX_LIMIT` on the API is 50 (T-056), so one request per member
 * reaches 50 and no further. That is a real limit on what may be claimed, and
 * `truncated()` exists so the page says so instead of presenting a window as a
 * career.
 */
export const COMPARE_WINDOW = 50;

export interface ComparedMatch {
  fixture: PredictionHistoryFixture;
  mine: Prediction;
  theirs: Prediction;
}

export interface Tally {
  /** Settled matches where both called the outcome correctly. */
  both: number;
  only_mine: number;
  only_theirs: number;
  neither: number;
}

/** Every match both members predicted, newest kick-off first. */
export function compared(
  mine: PredictionHistoryItem[],
  theirs: PredictionHistoryItem[],
): ComparedMatch[] {
  const ours = new Map(mine.map((item) => [item.fixture.id, item]));

  return theirs
    .filter((item) => ours.has(item.fixture.id))
    .map((item) => ({
      // Either copy of the fixture would do; they are the same match read by
      // the same endpoint.
      fixture: item.fixture,
      mine: (ours.get(item.fixture.id) as PredictionHistoryItem).prediction,
      theirs: item.prediction,
    }))
    .sort((a, b) => Date.parse(b.fixture.kickoff_at) - Date.parse(a.fixture.kickoff_at));
}

/**
 * The score line between two members, over settled matches only.
 *
 * Three exclusions, and each of them would otherwise flatter or punish somebody
 * for nothing they did.
 *
 * **Unsettled matches do not count.** A prediction on a match that has not been
 * judged is not a right or a wrong one, and counting it as a miss would make
 * the member who predicts further ahead look worse.
 *
 * **Void settlements do not count** (an abandoned match, say). Nobody was
 * wrong; there was no result.
 *
 * **A match is counted only when *both* settlements stand.** A tally where one
 * side is judged and the other is not is not a comparison of two members.
 */
export function tally(matches: ComparedMatch[]): Tally {
  const result: Tally = { both: 0, only_mine: 0, only_theirs: 0, neither: 0 };

  for (const match of matches) {
    const mine = match.mine.settlement;
    const theirs = match.theirs.settlement;
    if (mine === null || theirs === null) continue;
    if (mine.status !== 'settled' || theirs.status !== 'settled') continue;
    if (mine.outcome_correct === null || theirs.outcome_correct === null) continue;

    if (mine.outcome_correct && theirs.outcome_correct) result.both += 1;
    else if (mine.outcome_correct) result.only_mine += 1;
    else if (theirs.outcome_correct) result.only_theirs += 1;
    else result.neither += 1;
  }

  return result;
}

export function settledCount(counts: Tally): number {
  return counts.both + counts.only_mine + counts.only_theirs + counts.neither;
}

/**
 * Whether either member has predicted more than the comparison could read.
 *
 * The page says this out loud. A record built from the 50 most recent
 * predictions of a member who has made four hundred is a window, and calling a
 * window a record is the same failure as calling a partial module complete
 * (rule 3).
 */
export function truncated(mineTotal: number, theirsTotal: number): boolean {
  return mineTotal > COMPARE_WINDOW || theirsTotal > COMPARE_WINDOW;
}
