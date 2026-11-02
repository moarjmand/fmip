import type { FixtureStatus, ScoreDispute, ScoreLine } from '@fmip/contracts';

/**
 * Whether a finished match's recorded goals disagree with its result (T-1717,
 * D-347). Derived at read time from the rows the match centre and the scores
 * list already load, never stored (as D-343's freshness): no column, no
 * backfill, and the next answer that repairs the score or the incidents
 * clears it on its own.
 *
 * The result is the one a page shows (D-317, the web's `resultLine`): after
 * extra time where extra time was played, else the ninety minutes.
 *
 * Only MORE recorded goals than the result is a dispute: the incidents then
 * hold goals the score does not, so the score cannot be right as it stands
 * (Pafos v Hajduk, Los Garres v Manises: 2-0 against four goals). Fewer
 * recorded goals is a timeline the source left incomplete, and the score
 * stands: the timeline's own coverage says so (rule 3). The same total with
 * the sides differing is an own goal filed under one side or the other, as
 * data quality's `goals_disagree` reads it (T-820). On production
 * (2026-11-02) 12,300 of the 12,346 open `goals_disagree` findings had fewer
 * goals, 43 more, 3 the same total.
 *
 * The goals counted, as `goals_disagree` counts them:
 * - a goal with no side counts toward the total;
 * - a shoot-out's marked kicks are never goals (D-322); with a shoot-out on
 *   record, an unmarked penalty goal at 120 or later is read as a kick, so
 *   the smaller total is the one judged.
 *
 * Predictions, settlement and the model's evaluation do not read this.
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
  // With a shoot-out on record, the goals of play: the unmarked kicks are not
  // goals of the result (as data quality's finding, T-1640).
  const counted =
    scores.penalties !== null
      ? goals.filter((g) => !(g.kind === 'penalty_goal' && g.minute >= SHOOTOUT_MINUTE))
      : goals;
  if (counted.length <= reported.home + reported.away) return null;
  return { recorded_goals: counted.length, reported: { home: reported.home, away: reported.away } };
}
