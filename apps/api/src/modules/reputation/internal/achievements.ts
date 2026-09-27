import type { Achievement, AchievementKind, Achievements } from '@fmip/contracts';
import { ACHIEVEMENT_KINDS } from '@fmip/contracts';

/**
 * Achievements (blueprint 9.2, T-643, D-091), version 1: milestones derived on
 * read from what is already stored -- the member's current settlements, their
 * predictions' first submissions and the fixtures of the rounds they predicted
 * in. Nothing is written, so there is nothing to keep in step: the same rows
 * give the same list, and a settlement that is voided later takes its
 * milestone back with it (rule 8's discipline, applied to milestones).
 *
 * An achievement is a record of taking part. It is read by the profile and by
 * nothing else: not the rating, not a board, not an eligibility check.
 */
export const ACHIEVEMENT_RULES_V1 = {
  version: 'achievements@1.0.0',
  settledMilestones: [
    ['first_settled', 1],
    ['settled_10', 10],
    ['settled_50', 50],
    ['settled_100', 100],
  ],
  exactScoreMilestones: [
    ['first_exact_score', 1],
    ['exact_scores_5', 5],
  ],
  // The same runs as the `streak_5` / `streak_10` Career Points reasons.
  streakMilestones: [
    ['streak_5', 5],
    ['streak_10', 10],
  ],
  /** A round of one match is a match, not a matchday. */
  matchdayMinFixtures: 2,
  competitions: 5,
} as const satisfies {
  version: string;
  settledMilestones: readonly (readonly [AchievementKind, number])[];
  exactScoreMilestones: readonly (readonly [AchievementKind, number])[];
  streakMilestones: readonly (readonly [AchievementKind, number])[];
  matchdayMinFixtures: number;
  competitions: number;
};

/** One current `settled` settlement of the member's (voids are not here). */
export interface AchievementSettlement {
  settlementId: string;
  fixtureId: string;
  settledAt: string;
  outcomeCorrect: boolean;
  scoreCorrect: boolean | null;
}

/** One of the member's predictions: where, and when its first version was submitted. */
export interface AchievementPrediction {
  fixtureId: string;
  competitionId: string;
  firstSubmittedAt: string;
}

/** A round the member predicted in, with every fixture it holds (theirs or not). */
export interface AchievementRoundFacts {
  competition: { id: string; name: string };
  seasonId: string;
  seasonLabel: string;
  round: string;
  fixtures: { fixtureId: string; status: string }[];
}

export interface AchievementFacts {
  settlements: readonly AchievementSettlement[];
  predictions: readonly AchievementPrediction[];
  rounds: readonly AchievementRoundFacts[];
}

/** A round is still being played while one of its fixtures may yet kick off or finish. */
const OPEN_STATUSES = new Set(['scheduled', 'live', 'suspended']);

const bySettlement = (a: AchievementSettlement, b: AchievementSettlement): number =>
  a.settledAt.localeCompare(b.settledAt) || a.settlementId.localeCompare(b.settlementId);

/**
 * Every achievement the facts have earned, each once, at the stored time of
 * the row that earned it; earliest first, then in `ACHIEVEMENT_KINDS` order.
 *
 * - Settled milestones: the n-th settlement in settlement order.
 * - Exact scores: the n-th settlement whose exact score was right.
 * - Streaks: the settlement completing the first run of n correct outcomes in
 *   a row, in the order Career Points counts them (voids neither break nor
 *   extend a run, because they are not settlements here).
 * - Full matchday: a round (one season, one `round` value) none of whose
 *   fixtures is still to be played, with at least two finished fixtures, every
 *   one of which the member predicted and had settled. Fixtures that were
 *   postponed, abandoned, cancelled or awarded settle void and are neither
 *   required nor counted. A prediction is refused after kick-off by the
 *   database, so "every one before kick-off" holds by construction. Earned at
 *   the last of those settlements, for the first round to complete.
 * - Five competitions: the first prediction's first submission in the fifth
 *   competition the member predicted in.
 */
export function deriveAchievements(
  facts: AchievementFacts,
  computedAt: string,
  rules = ACHIEVEMENT_RULES_V1,
): Achievements {
  const earned: Achievement[] = [];
  const add = (
    kind: AchievementKind,
    earnedAt: string | undefined,
    round: Achievement['round'] = null,
  ): void => {
    if (earnedAt !== undefined) earned.push({ kind, earned_at: earnedAt, round });
  };

  const settled = [...facts.settlements].sort(bySettlement);
  for (const [kind, n] of rules.settledMilestones) add(kind, settled[n - 1]?.settledAt);

  const exact = settled.filter((s) => s.scoreCorrect === true);
  for (const [kind, n] of rules.exactScoreMilestones) add(kind, exact[n - 1]?.settledAt);

  for (const [kind, n] of rules.streakMilestones) {
    let run = 0;
    const completing = settled.find((s) => {
      run = s.outcomeCorrect ? run + 1 : 0;
      return run === n;
    });
    add(kind, completing?.settledAt);
  }

  const settledByFixture = new Map(settled.map((s) => [s.fixtureId, s]));
  let matchday: { at: string; round: Achievement['round'] } | null = null;
  for (const round of facts.rounds) {
    if (round.fixtures.some((f) => OPEN_STATUSES.has(f.status))) continue;
    const played = round.fixtures.filter((f) => f.status === 'finished');
    if (played.length < rules.matchdayMinFixtures) continue;
    const mine = played.map((f) => settledByFixture.get(f.fixtureId));
    if (mine.some((s) => s === undefined)) continue;
    const at = mine
      .map((s) => s!.settledAt)
      .sort()
      .at(-1)!;
    if (matchday === null || at < matchday.at) {
      matchday = {
        at,
        round: {
          competition: { id: round.competition.id, name: round.competition.name },
          season_label: round.seasonLabel,
          round: round.round,
        },
      };
    }
  }
  if (matchday !== null) add('full_matchday', matchday.at, matchday.round);

  const firstByCompetition = new Map<string, string>();
  for (const p of facts.predictions) {
    const seen = firstByCompetition.get(p.competitionId);
    if (seen === undefined || p.firstSubmittedAt < seen)
      firstByCompetition.set(p.competitionId, p.firstSubmittedAt);
  }
  add('competitions_5', [...firstByCompetition.values()].sort()[rules.competitions - 1]);

  const order = (kind: AchievementKind): number => ACHIEVEMENT_KINDS.indexOf(kind);
  earned.sort((a, b) => a.earned_at.localeCompare(b.earned_at) || order(a.kind) - order(b.kind));
  return { rules_version: rules.version, earned, computed_at: computedAt };
}
