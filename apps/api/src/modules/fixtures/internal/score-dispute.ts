import type { FixtureStatus, ScoreDispute, ScoreLine } from '@fmip/contracts';

/**
 * Whether a finished match's recorded goals disagree with its result (T-1717,
 * D-347). Derived at read time from the rows the match centre and the scores
 * list already load, never stored (as D-343's freshness): no column, no
 * backfill, and the next answer that repairs the score or the incidents
 * clears it on its own.
 *
 * The result is the one a page shows (D-317, the web's `resultLine`): after
 * extra time where extra time was played, else the ninety minutes. The goals
 * are judged with the same readings as data quality's `goals_disagree`
 * (T-820), so a match is called disputed only when no reasonable reading of
 * its incidents adds up to that result:
 * - an own goal filed under the side credited or under the scorer's own side;
 * - a goal with no side counts toward the total only;
 * - a shoot-out's marked kicks are never goals (D-322); with a shoot-out on
 *   record, an unmarked penalty goal at 120 or later may be a kick too.
 *
 * Nothing is claimed for a match with no goal recorded: that is the
 * incidents' coverage, not a contradiction (rule 3). Predictions, settlement
 * and the model's evaluation do not read this.
 */

/** One incident as the match centre and the scores list carry it. */
export interface DisputeIncident {
  kind: string;
  side: 'home' | 'away' | null;
  minute: number;
  in_shootout?: boolean;
}

interface DisputeScores {
  current: ScoreLine | null;
  full_time: ScoreLine | null;
  extra_time: ScoreLine | null;
  penalties: ScoreLine | null;
}

const GOAL_KINDS: ReadonlySet<string> = new Set(['goal', 'own_goal', 'penalty_goal']);

/** Where a feed with no shoot-out mark files the kicks (data quality's reading). */
const SHOOTOUT_MINUTE = 120;

/** The result a finished match's page shows (D-317), as the web's `resultLine`. */
export function shownResult(scores: DisputeScores): ScoreLine | null {
  return scores.extra_time !== null
    ? (scores.current ?? scores.full_time)
    : (scores.full_time ?? scores.current);
}

function agrees(
  goals: readonly DisputeIncident[],
  reported: ScoreLine,
  ownOnCredited: boolean,
): boolean {
  let home = 0;
  let away = 0;
  let unattributed = 0;
  for (const goal of goals) {
    if (goal.side === null) {
      unattributed += 1;
      continue;
    }
    const credited =
      goal.kind === 'own_goal' && !ownOnCredited
        ? goal.side === 'home'
          ? 'away'
          : 'home'
        : goal.side;
    if (credited === 'home') home += 1;
    else away += 1;
  }
  return unattributed === 0
    ? home === reported.home && away === reported.away
    : home + away + unattributed === reported.home + reported.away &&
        home <= reported.home &&
        away <= reported.away;
}

export function scoreDisputeOf(
  status: FixtureStatus,
  scores: DisputeScores,
  incidents: readonly DisputeIncident[],
): ScoreDispute | null {
  if (status !== 'finished') return null;
  const reported = shownResult(scores);
  if (reported === null) return null;
  const goals = incidents.filter((i) => GOAL_KINDS.has(i.kind) && i.in_shootout !== true);
  if (goals.length === 0) return null;
  const readings: (readonly DisputeIncident[])[] = [goals];
  if (scores.penalties !== null) {
    readings.push(goals.filter((g) => !(g.kind === 'penalty_goal' && g.minute >= SHOOTOUT_MINUTE)));
  }
  if (readings.some((r) => agrees(r, reported, true) || agrees(r, reported, false))) return null;
  // With a shoot-out on record, the goals of play: the unmarked kicks are not
  // goals of the result (as data quality's finding, T-1640).
  const counted = readings[readings.length - 1]!;
  return { recorded_goals: counted.length, reported: { home: reported.home, away: reported.away } };
}
