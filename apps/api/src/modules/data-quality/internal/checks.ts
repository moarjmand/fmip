import type { DataQualityCheck } from '@fmip/contracts';

/**
 * The data-quality checks (T-820), each a pure function from rows the store
 * read to a finding or nothing. No clock and no I/O here: `now` and every row
 * are arguments, so each check is tested on its own against recorded shapes.
 *
 * A check says what it found and never what the answer should be: nothing is
 * corrected automatically (E82). A row a check cannot judge -- no timeline to
 * count, no score to count against -- is not a finding: absence is coverage's
 * business (rule 3), not a contradiction.
 */

export type Side = 'home' | 'away';

/** One thing a check found, as the store records it. */
export interface Finding {
  check: DataQualityCheck;
  /** Stable across sweeps within one check: what the finding is about. */
  subjectKey: string;
  fixtureId: string | null;
  relatedFixtureId: string | null;
  teamId: string | null;
  seasonId: string | null;
  competitionId: string | null;
  detail: string;
}

/** Where a fixture sits, for the finding's links and its competition. */
export interface FixtureRef {
  fixtureId: string;
  seasonId: string;
  competitionId: string;
}

function onFixture(
  check: DataQualityCheck,
  ref: FixtureRef,
  detail: string,
  subjectKey: string = ref.fixtureId,
): Finding {
  return {
    check,
    subjectKey,
    fixtureId: ref.fixtureId,
    relatedFixtureId: null,
    teamId: null,
    seasonId: ref.seasonId,
    competitionId: ref.competitionId,
    detail,
  };
}

// ---------------------------------------------------------------------------
// A finished match without a full-time score
// ---------------------------------------------------------------------------

export interface ScoreKindsRow extends FixtureRef {
  status: string;
  /** The `fixture_score` kinds stored for the fixture. */
  kinds: string[];
}

/**
 * `finished` with no `full_time` row. Every adapter writes one for a finished
 * match (API-Football falls back to its final goals), so its absence is a
 * write that went wrong, not a provider that left it out.
 */
export function finishedWithoutScore(row: ScoreKindsRow): Finding | null {
  if (row.status !== 'finished' || row.kinds.includes('full_time')) return null;
  const detail =
    row.kinds.length === 0
      ? 'finished with no score stored at all'
      : `finished with no full-time score (stored: ${[...row.kinds].sort().join(', ')})`;
  return onFixture('finished_without_score', row, detail);
}

// ---------------------------------------------------------------------------
// Goals in the timeline against the score
// ---------------------------------------------------------------------------

export type GoalKind = 'goal' | 'own_goal' | 'penalty_goal';
export interface Score {
  home: number;
  away: number;
}

export interface GoalsRow extends FixtureRef {
  status: string;
  /** Scores by `fixture_score.kind`. */
  scores: Partial<Record<string, Score>>;
  /** Every incident of the fixture, of any kind. */
  incidents: number;
  /** The goal incidents, with the side of the participant credited (null: none named). */
  goals: { kind: GoalKind; side: Side | null; minute: number }[];
}

/**
 * The score the timeline should add up to: `current` while live; once
 * finished `current` too (every adapter's final, extra time included), then
 * the after-extra-time score, then the 90-minute one.
 */
export function expectedScore(row: Pick<GoalsRow, 'status' | 'scores'>): Score | null {
  const s = row.scores;
  if (row.status === 'live') return s.current ?? null;
  if (row.status === 'finished') return s.current ?? s.extra_time ?? s.full_time ?? null;
  return null;
}

/** A shoot-out penalty looks like a penalty goal at 120 in some feeds. */
const SHOOTOUT_MINUTE = 120;

function tally(
  goals: GoalsRow['goals'],
  ownOnCredited: boolean,
  dropShootout: boolean,
): Score & { unattributed: number } {
  let home = 0;
  let away = 0;
  let unattributed = 0;
  for (const goal of goals) {
    if (dropShootout && goal.kind === 'penalty_goal' && goal.minute >= SHOOTOUT_MINUTE) continue;
    if (goal.side === null) {
      unattributed += 1;
      continue;
    }
    const side =
      goal.kind === 'own_goal' && !ownOnCredited
        ? goal.side === 'home'
          ? 'away'
          : 'home'
        : goal.side;
    if (side === 'home') home += 1;
    else away += 1;
  }
  return { home, away, unattributed };
}

/**
 * The timeline's goals against the score. Judged only where both exist: a
 * fixture with no incident stored has no timeline to disagree (that is the
 * `incidents` coverage, not a contradiction).
 *
 * Two readings are accepted because feeds differ and neither is a
 * contradiction of the score: an own goal filed under the side credited
 * (`incident.participant_id`'s meaning) or under the scorer's own side; and,
 * when a shoot-out was recorded, shoot-out kicks filed as penalty goals at
 * 120. A goal with no side counts toward the total only.
 */
export function goalsDisagree(row: GoalsRow): Finding | null {
  if (row.incidents === 0) return null;
  const expected = expectedScore(row);
  if (expected === null) return null;
  const shootout = row.scores.penalties !== undefined;
  const readings = [false, true].flatMap((drop) =>
    drop && !shootout ? [] : [tally(row.goals, true, drop), tally(row.goals, false, drop)],
  );
  const agrees = readings.some((t) =>
    t.unattributed === 0
      ? t.home === expected.home && t.away === expected.away
      : t.home + t.away + t.unattributed === expected.home + expected.away &&
        t.home <= expected.home &&
        t.away <= expected.away,
  );
  if (agrees) return null;
  const shown = readings[0]!;
  const unnamed = shown.unattributed > 0 ? ` and ${shown.unattributed} with no side` : '';
  return onFixture(
    'goals_disagree',
    row,
    `the timeline has ${shown.home}-${shown.away}${unnamed}, the score is ${expected.home}-${expected.away}`,
  );
}

// ---------------------------------------------------------------------------
// A live match far past its expected length
// ---------------------------------------------------------------------------

/**
 * Minutes after kick-off at which a match still `live` is a finding. Ninety
 * minutes, a fifteen-minute interval, stoppage time, extra time with its
 * break and a shoot-out come to about two and three-quarter hours; three
 * hours is past all of it (D-097).
 */
export const LIVE_OVERRUN_MINUTES = 180;

export interface LiveRow extends FixtureRef {
  status: string;
  kickoffAt: Date;
  minute: number | null;
}

export function liveOverrun(row: LiveRow, now: Date): Finding | null {
  if (row.status !== 'live') return null;
  const minutes = Math.floor((now.getTime() - row.kickoffAt.getTime()) / 60_000);
  if (minutes < LIVE_OVERRUN_MINUTES) return null;
  const hours = Math.floor(minutes / 60);
  const clock = row.minute === null ? 'no minute stored' : `the clock says ${row.minute}'`;
  return onFixture(
    'live_overrun',
    row,
    `still live more than ${hours} hour${hours === 1 ? '' : 's'} after kick-off (${clock})`,
  );
}

// ---------------------------------------------------------------------------
// A line-up that is not eleven
// ---------------------------------------------------------------------------

export const STARTERS = 11;

export interface LineupRow extends FixtureRef {
  side: Side;
  teamId: string;
  starters: number;
  bench: number;
}

/** One side's stored line-up with other than eleven starters. No line-up stored is not a finding. */
export function lineupNotEleven(row: LineupRow): Finding | null {
  if (row.starters + row.bench === 0 || row.starters === STARTERS) return null;
  return {
    ...onFixture(
      'lineup_not_eleven',
      row,
      `the ${row.side} line-up has ${row.starters} starter${row.starters === 1 ? '' : 's'}`,
      `${row.fixtureId}:${row.side}`,
    ),
    teamId: row.teamId,
  };
}

// ---------------------------------------------------------------------------
// One match stored twice
// ---------------------------------------------------------------------------

export interface MappingRow extends FixtureRef {
  provider: string;
  ids: number;
}

/**
 * One fixture carrying more than one id from the same provider: the provider
 * has two records for what we hold as one match, and every refresh of either
 * writes over the other. (The other direction -- one provider id on two of
 * our fixtures -- is refused by `provider_mapping`'s unique key.)
 */
export function fixtureMappedTwice(row: MappingRow): Finding | null {
  if (row.ids < 2) return null;
  return onFixture(
    'fixture_mapped_twice',
    row,
    `${row.ids} ids from ${row.provider} point at this fixture`,
    `${row.fixtureId}:${row.provider}`,
  );
}

/** Two fixtures this close with the same home and away teams are one match (D-097). */
export const DUPLICATE_WINDOW_DAYS = 3;

export interface PairRow extends FixtureRef {
  otherFixtureId: string;
  kickoffAt: Date;
  otherKickoffAt: Date;
  status: string;
  otherStatus: string;
}

/**
 * Two fixtures of one season, the same home team and the same away team,
 * kicking off within three days: the provider issued a second id for one
 * match (a rearrangement, a re-import) and both are on the scores page. A
 * cancelled one is the provider saying so, and not a duplicate.
 */
export function duplicateFixture(row: PairRow): Finding | null {
  if (row.fixtureId === row.otherFixtureId) return null;
  if (row.status === 'cancelled' || row.otherStatus === 'cancelled') return null;
  const apart = Math.abs(row.kickoffAt.getTime() - row.otherKickoffAt.getTime());
  if (apart > DUPLICATE_WINDOW_DAYS * 24 * 60 * 60 * 1000) return null;
  const [first, second] = [row.fixtureId, row.otherFixtureId].sort() as [string, string];
  // The statuses in kick-off order, so the detail reads the same whichever way round the pair was read.
  const ordered = [
    { at: row.kickoffAt.getTime(), id: row.fixtureId, status: row.status },
    { at: row.otherKickoffAt.getTime(), id: row.otherFixtureId, status: row.otherStatus },
  ].sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1));
  return {
    ...onFixture(
      'duplicate_fixture',
      { ...row, fixtureId: first },
      `the same home and away teams twice within ${DUPLICATE_WINDOW_DAYS} days (${ordered[0]!.status}, then ${ordered[1]!.status})`,
      `${first}:${second}`,
    ),
    relatedFixtureId: second,
  };
}

// ---------------------------------------------------------------------------
// The provider's table against ours
// ---------------------------------------------------------------------------

export interface TableComparison {
  teamId: string;
  providerPlayed: number;
  /** `undefined`: the team has no row in the table we compute (D-038). */
  ourPlayed: number | undefined;
}

/**
 * The standings job's comparison (T-030) as findings: a team whose played
 * count here is not the provider's has a result we have not stored (or one
 * we should not have), and the table on its page is wrong by that much. A
 * team the provider has not seen play yet is no gap. Teams in the provider's
 * table with no mapping are one finding for the season.
 */
export function tableDisagreements(
  season: { seasonId: string; competitionId: string },
  comparisons: readonly TableComparison[],
  unmapped: number,
): Finding[] {
  const out: Finding[] = [];
  const base = {
    check: 'table_disagrees' as const,
    fixtureId: null,
    relatedFixtureId: null,
    seasonId: season.seasonId,
    competitionId: season.competitionId,
  };
  for (const c of comparisons) {
    if (c.ourPlayed === c.providerPlayed) continue;
    if (c.ourPlayed === undefined && c.providerPlayed === 0) continue;
    out.push({
      ...base,
      subjectKey: `${season.seasonId}:${c.teamId}`,
      teamId: c.teamId,
      detail:
        c.ourPlayed === undefined
          ? `the provider's table has ${c.providerPlayed} played, ours has no row`
          : `the provider's table has ${c.providerPlayed} played, ours ${c.ourPlayed}`,
    });
  }
  if (unmapped > 0) {
    out.push({
      ...base,
      subjectKey: `${season.seasonId}:unmapped`,
      teamId: null,
      detail: `${unmapped} team${unmapped === 1 ? '' : 's'} in the provider's table ha${unmapped === 1 ? 's' : 've'} no mapping`,
    });
  }
  return out;
}

/** The checks one sweep runs over the stored data; `table_disagrees` comes from the standings job. */
export const SWEPT_CHECKS: readonly DataQualityCheck[] = [
  'finished_without_score',
  'goals_disagree',
  'live_overrun',
  'lineup_not_eleven',
  'fixture_mapped_twice',
  'duplicate_fixture',
];
