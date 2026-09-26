import type { Measurement } from './power-index';

/**
 * The two Power Index components our own match records can reach once a paid
 * feed supplies line-ups and player ratings (T-112, D-081): line-up quality
 * and stability. Pure, like the other measurements: the store gathers, this
 * decides, and every number is a position in the competition's own
 * distribution, never a bag of points (blueprint 6.1).
 */

/** A player is rated once they have a provider rating from this many minutes. */
export const RATED_MINUTES = 20;
/** An XI is measurable when this many of its starters are rated. */
export const MIN_RATED_STARTERS = 7;
/** A position needs this many other teams to be a position at all. */
export const MIN_OTHER_TEAMS = 5;
/** Line-up continuity is read over this many consecutive pairs of matches. */
export const CONTINUITY_PAIRS = 3;

export interface SeasonMatch {
  kickoffAt: Date;
  /** The coach the line-up named; `null` when none was recorded. */
  coachId: string | null;
  /** The starting XI; empty when no line-up was recorded. */
  starters: string[];
}

export interface SquadContext {
  /** Every team of the fixture's season, its finished matches before the kick-off, oldest first. */
  matches: Map<string, SeasonMatch[]>;
  /** Each player's mean provider rating over the season before the kick-off. */
  ratings: Map<string, number>;
  /** The fixture's announced starters per team, when a line-up is confirmed. */
  confirmed: Map<string, string[]>;
  /** Players the provider lists as out of this fixture, per team (T-103). */
  out: Map<string, string[]>;
}

/** Share of `others` below `value`, ties counting half. */
export function positionAmong(value: number, others: number[]): number {
  const below = others.filter((o) => o < value).length;
  const tied = others.filter((o) => o === value).length;
  return (below + tied / 2) / others.length;
}

function mean(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** The mean rating of an XI's rated starters, or `null` when too few are rated. */
export function xiStrength(starters: string[], ratings: Map<string, number>): number | null {
  const rated = starters.flatMap((id) => {
    const rating = ratings.get(id);
    return rating === undefined ? [] : [rating];
  });
  return rated.length >= MIN_RATED_STARTERS ? mean(rated) : null;
}

function lastXi(matches: SeasonMatch[] | undefined): string[] {
  const withXi = (matches ?? []).filter((m) => m.starters.length > 0);
  return withXi.at(-1)?.starters ?? [];
}

/**
 * Expected or confirmed line-up quality (blueprint 6.1, 20%): the subject's XI
 * -- announced, or else its last XI less the players reported out -- placed
 * among every other team's most recent XI, each measured by its starters'
 * season ratings before this kick-off.
 */
export function measureLineup(context: SquadContext, teamId: string): Measurement {
  const confirmed = context.confirmed.get(teamId);
  const out = new Set(context.out.get(teamId) ?? []);
  const xi =
    confirmed !== undefined && confirmed.length > 0
      ? confirmed
      : lastXi(context.matches.get(teamId)).filter((id) => !out.has(id));
  if (xi.length === 0) {
    return { value: null, note: 'no line-up recorded for this team yet this season' };
  }
  const strength = xiStrength(xi, context.ratings);
  if (strength === null) {
    return {
      value: null,
      note: `fewer than ${MIN_RATED_STARTERS} of the line-up have a rating this season`,
    };
  }
  const others = [...context.matches.keys()]
    .filter((id) => id !== teamId)
    .flatMap((id) => {
      const s = xiStrength(lastXi(context.matches.get(id)), context.ratings);
      return s === null ? [] : [s];
    });
  if (others.length < MIN_OTHER_TEAMS) {
    return { value: null, note: 'too few teams in this competition have a measurable line-up' };
  }
  const isConfirmed = confirmed !== undefined && confirmed.length > 0;
  const allRated = xi.every((id) => context.ratings.has(id));
  const dropped = isConfirmed ? 0 : lastXi(context.matches.get(teamId)).length - xi.length;
  return {
    value: positionAmong(strength, others),
    state: isConfirmed && allRated && xi.length === 11 ? 'available' : 'limited',
    note: isConfirmed
      ? 'the announced starting XI, by its players’ ratings this season'
      : dropped > 0
        ? `expected: the last starting XI less ${dropped} reported out, by their ratings this season`
        : 'expected: the last starting XI, by its players’ ratings this season',
  };
}

/** Share of a team's matches with a recorded coach led by the coach of its latest one. */
export function coachContinuity(matches: SeasonMatch[] | undefined): number | null {
  const coached = (matches ?? []).filter((m) => m.coachId !== null);
  const current = coached.at(-1)?.coachId;
  if (current === undefined) return null;
  return coached.filter((m) => m.coachId === current).length / coached.length;
}

/** Mean share of starters kept from one match to the next, over the latest pairs. */
export function xiContinuity(matches: SeasonMatch[] | undefined): number | null {
  const xis = (matches ?? []).map((m) => m.starters).filter((s) => s.length > 0);
  const pairs = xis.slice(-(CONTINUITY_PAIRS + 1));
  if (pairs.length < 2) return null;
  const kept: number[] = [];
  for (let i = 1; i < pairs.length; i += 1) {
    const before = new Set(pairs[i - 1]);
    const now = pairs[i] ?? [];
    kept.push(now.filter((id) => before.has(id)).length / now.length);
  }
  return mean(kept);
}

/**
 * Managerial and team stability (blueprint 6.1, 5%): how long the current
 * coach has led the team this season and how much of its XI carries over from
 * match to match, each placed among the competition's teams, then averaged.
 * Either half alone is used, and says so, when the other cannot be measured.
 */
export function measureStability(context: SquadContext, teamId: string): Measurement {
  const others = [...context.matches.keys()].filter((id) => id !== teamId);
  const place = (read: (m: SeasonMatch[] | undefined) => number | null): number | null => {
    const own = read(context.matches.get(teamId));
    if (own === null) return null;
    const rest = others.flatMap((id) => {
      const v = read(context.matches.get(id));
      return v === null ? [] : [v];
    });
    return rest.length >= MIN_OTHER_TEAMS ? positionAmong(own, rest) : null;
  };
  const coach = place(coachContinuity);
  const xi = place(xiContinuity);
  if (coach === null && xi === null) {
    return { value: null, note: 'too few line-ups recorded this season to place the team' };
  }
  if (coach !== null && xi !== null) {
    return {
      value: (coach + xi) / 2,
      state: 'available',
      note: 'the coach’s run this season and how much of the XI carries over',
    };
  }
  return coach !== null
    ? { value: coach, state: 'limited', note: 'the coach’s run this season only' }
    : { value: xi as number, state: 'limited', note: 'how much of the XI carries over only' };
}
