/**
 * Measuring the Power Index components (T-111).
 *
 * Pure: it takes a division's match history and a team's schedule and returns
 * the component values that `power-index.ts` combines. No database, no Nest, so
 * every definition below can be argued with in a test rather than inferred from
 * a query plan.
 *
 * **Everything is a percentile, not a score.** The blueprint says the index is
 * "not created by adding arbitrary fixed points", so a component is a team's
 * position among the teams it is being compared with — the others in the same
 * division over the same window. A value of 0.8 means "ahead of eight in ten of
 * this league", which is a claim that can be checked against results. The one
 * exception is rest, which has no meaningful population to rank against (every
 * team in a free midweek is equally rested), and whose curve is therefore
 * written out as named constants below.
 *
 * **A component nobody can measure is absent, not average.** Too little history
 * for a team, an unknown previous fixture, a division we hold nothing for: each
 * of those returns `null` with a note, and `combine` redistributes the weight
 * (rule 3).
 */

import type { Measurement, Measurements } from './power-index';

/** About a season: long enough to be strength rather than form. */
export const LONG_WINDOW_MATCHES = 38;

/** The blueprint's "recent" — six matches is roughly six weeks of a league. */
export const FORM_WINDOW_MATCHES = 6;

/** Below this, a team's record is too short to place it in a distribution. */
export const MIN_MATCHES_FOR_STRENGTH = 5;

/** Fewer teams than this in a division and a percentile means nothing. */
export const MIN_TEAMS_FOR_PERCENTILE = 4;

/** The rest curve: two days or less is the hardest turnaround a fixture list produces. */
export const REST_FLOOR_DAYS = 2;
/** A clear week is an ordinary, unpressured preparation. */
export const REST_CEILING_DAYS = 7;
/** Matches in the previous fortnight at which a schedule counts as fully congested. */
export const CONGESTION_CEILING = 4;
export const CONGESTION_WINDOW_DAYS = 14;

/** One finished match, as the training store holds it. */
export interface HistoryMatch {
  /** ISO date, `YYYY-MM-DD`. */
  date: string;
  home: string;
  away: string;
  homeGoals: number;
  awayGoals: number;
}

/** What the schedule says about a team's last fortnight before this kick-off. */
export interface RestInput {
  /** Days between the previous fixture and this kick-off; `null` when unknown. */
  daysSincePrevious: number | null;
  /** Fixtures in the `CONGESTION_WINDOW_DAYS` before this kick-off, this one excluded. */
  matchesInWindow: number;
}

export type Side = 'home' | 'away';

interface Appearance {
  date: string;
  side: Side;
  opponent: string;
  points: number;
  goalDifference: number;
}

export interface TeamRecord {
  team: string;
  appearances: Appearance[];
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function mean(values: number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function pointsFor(goalsFor: number, goalsAgainst: number): number {
  return goalsFor > goalsAgainst ? 3 : goalsFor === goalsAgainst ? 1 : 0;
}

/**
 * Every team's appearances in the window, newest first.
 *
 * The window is the last `LONG_WINDOW_MATCHES` *of the division*, counted per
 * team rather than globally, so a team that joined late is not compared on a
 * shorter record without anyone noticing — its appearance count is what
 * `MIN_MATCHES_FOR_STRENGTH` then checks.
 */
export function records(matches: HistoryMatch[]): Map<string, TeamRecord> {
  const byTeam = new Map<string, TeamRecord>();

  const add = (team: string, appearance: Appearance): void => {
    const existing = byTeam.get(team);
    if (existing === undefined) byTeam.set(team, { team, appearances: [appearance] });
    else existing.appearances.push(appearance);
  };

  for (const match of [...matches].sort((a, b) => b.date.localeCompare(a.date))) {
    add(match.home, {
      date: match.date,
      side: 'home',
      opponent: match.away,
      points: pointsFor(match.homeGoals, match.awayGoals),
      goalDifference: match.homeGoals - match.awayGoals,
    });
    add(match.away, {
      date: match.date,
      side: 'away',
      opponent: match.home,
      points: pointsFor(match.awayGoals, match.homeGoals),
      goalDifference: match.awayGoals - match.homeGoals,
    });
  }

  for (const record of byTeam.values()) {
    record.appearances = record.appearances.slice(0, LONG_WINDOW_MATCHES);
  }
  return byTeam;
}

/**
 * Where `value` sits in `population`, from 0 to 1.
 *
 * The mid-rank convention — everything strictly below, plus half of the ties —
 * so two teams with identical records get the same number and a division of
 * identical teams sits at 0.5 rather than at 1.
 */
export function percentile(value: number, population: number[]): number {
  if (population.length === 0) return 0.5;
  let below = 0;
  let equal = 0;
  for (const other of population) {
    if (other < value) below += 1;
    else if (other === value) equal += 1;
  }
  return clamp01((below + equal / 2) / population.length);
}

/** Goal difference per match over the long window: the strength measure. */
export function strengthOf(record: TeamRecord): number {
  return mean(record.appearances.map((a) => a.goalDifference));
}

/** Points per match at one venue over the long window. */
export function venueFormOf(record: TeamRecord, side: Side): number | null {
  const atSide = record.appearances.filter((a) => a.side === side);
  if (atSide.length === 0) return null;
  return mean(atSide.map((a) => a.points)) / 3;
}

/**
 * Recent performance, adjusted for who it was against.
 *
 * Each of the last `FORM_WINDOW_MATCHES` contributes its points as a fraction
 * of three, scaled by the opponent's strength percentile plus a half — so
 * taking a point off the best team in the division counts for roughly three
 * times what taking one off the worst does, and a win over nobody is not a
 * run of form. The blueprint asks for "recent opponent-adjusted performance";
 * this is the adjustment, written down.
 */
export function formOf(
  record: TeamRecord,
  strengthPercentiles: Map<string, number>,
): number | null {
  const recent = record.appearances.slice(0, FORM_WINDOW_MATCHES);
  if (recent.length === 0) return null;
  return mean(
    recent.map((appearance) => {
      const opponent = strengthPercentiles.get(appearance.opponent) ?? 0.5;
      return (appearance.points / 3) * (0.5 + opponent);
    }),
  );
}

/**
 * Rest and schedule, as a number between 0 and 1.
 *
 * The binding constraint of the two, not their average: a team with a clear
 * week but four matches behind it in a fortnight is not fresh, and a mean would
 * quietly say it was. Travel is the third thing the blueprint names here and is
 * not modelled — we hold no venue coordinates — which is why the caller marks
 * this component `limited` rather than `available`.
 */
export function restOf(input: RestInput): number | null {
  if (input.daysSincePrevious === null) return null;
  const rested = clamp01(
    (input.daysSincePrevious - REST_FLOOR_DAYS) / (REST_CEILING_DAYS - REST_FLOOR_DAYS),
  );
  const uncongested = clamp01(
    1 - Math.max(0, input.matchesInWindow - 1) / (CONGESTION_CEILING - 1),
  );
  return Math.min(rested, uncongested);
}

export interface MeasureInput {
  /** The team's name in the training store, for this division. */
  trainingName: string;
  side: Side;
  /** Every finished match of the division in the window. */
  history: HistoryMatch[];
  rest: RestInput;
  /** Why the history is what it is, when it is thin. */
  divisionNote?: string;
}

/**
 * The five components this data can reach, for one team in one fixture.
 *
 * The two it cannot are returned absent with the reason, rather than omitted:
 * a reader looking at the panel should see that line-up quality was considered
 * and could not be measured, not be left to wonder whether anyone thought of it.
 */
export function measure(input: MeasureInput): Measurements {
  const all = records(input.history);
  const record = all.get(input.trainingName);

  const absent = (note: string): Measurement => ({ value: null, note });

  const missing: Measurements = {
    lineup_quality: absent('no player ratings on the free data (D-049)'),
    stability: absent('no manager or squad-stability feed on the free data (D-049)'),
    competition_context: absent(
      'not modelled: needs the stakes of this stage and the team’s other commitments',
    ),
  };

  if (record === undefined) {
    return {
      ...missing,
      underlying_strength: absent(`no recorded matches for ${input.trainingName} in this division`),
      recent_form: absent(`no recorded matches for ${input.trainingName} in this division`),
      venue: absent(`no recorded matches for ${input.trainingName} in this division`),
      rest_and_congestion: measureRest(input.rest),
    };
  }

  const eligible = [...all.values()].filter(
    (other) => other.appearances.length >= MIN_MATCHES_FOR_STRENGTH,
  );
  const thin = record.appearances.length < MIN_MATCHES_FOR_STRENGTH;
  const tooFewTeams = eligible.length < MIN_TEAMS_FOR_PERCENTILE;

  if (tooFewTeams) {
    const note = `only ${eligible.length} teams in this division have enough history to rank against`;
    return {
      ...missing,
      underlying_strength: absent(note),
      recent_form: absent(note),
      venue: absent(note),
      rest_and_congestion: measureRest(input.rest),
    };
  }

  const strengths = eligible.map(strengthOf);
  const strengthPercentiles = new Map(
    eligible.map((other) => [other.team, percentile(strengthOf(other), strengths)]),
  );

  const state = thin ? ('limited' as const) : ('available' as const);
  const thinNote = thin
    ? `only ${record.appearances.length} matches of history`
    : (input.divisionNote ?? null);

  const forms = eligible
    .map((other) => formOf(other, strengthPercentiles))
    .filter((value): value is number => value !== null);
  const form = formOf(record, strengthPercentiles);

  const venuePopulation = eligible
    .map((other) => venueFormOf(other, input.side))
    .filter((value): value is number => value !== null);
  const venue = venueFormOf(record, input.side);

  return {
    ...missing,
    underlying_strength: {
      value: percentile(strengthOf(record), strengths),
      state,
      ...(thinNote === null ? {} : { note: thinNote }),
    },
    recent_form:
      form === null
        ? absent('no matches in the recent window')
        : {
            value: percentile(form, forms),
            state,
            note: `last ${Math.min(record.appearances.length, FORM_WINDOW_MATCHES)} matches, adjusted for opponent strength`,
          },
    venue:
      venue === null
        ? absent(`no ${input.side} matches in the window`)
        : {
            value: percentile(venue, venuePopulation),
            state,
            note: `${input.side} record over the last ${record.appearances.length} matches`,
          },
    rest_and_congestion: measureRest(input.rest),
  };
}

function measureRest(rest: RestInput): Measurement {
  const value = restOf(rest);
  if (value === null) {
    return { value: null, note: 'no previous fixture on record, so rest cannot be measured' };
  }
  return {
    value,
    // Never `available`: the blueprint's third element here is travel, and we
    // hold no venue coordinates to measure it with.
    state: 'limited',
    note: `${rest.daysSincePrevious} days since the previous match, ${rest.matchesInWindow} in the last ${CONGESTION_WINDOW_DAYS}; travel not modelled`,
  };
}
