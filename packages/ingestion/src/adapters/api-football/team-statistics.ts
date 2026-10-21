/**
 * API-Football `/teams/statistics?league=&season=&team=` → the normalised
 * model (T-1437, D-228). Kept apart from `map.ts`, as `player-seasons.ts` is.
 *
 * Recorded 2026-10-21 (`_fixtures/api-football-team-statistics/`). What the
 * recordings showed, and what this mapping does about it:
 *  - `response` is one object, not a list (the envelope reads it as a list
 *    of one); a team the provider has no statistics for has none, or a
 *    season of no matches played.
 *  - `goals.*.minute` bands do not add up exactly to the goal totals even in a
 *    league (68 for 69), but in a cup they count the kicks of a penalty
 *    shoot-out under "106-120" (12 for 4), and `penalty` counts those kicks
 *    too (8 of 10 "scored" in a run of 4 goals). Bands that miss the total by
 *    more than `BAND_TOLERANCE` are left out with the penalties.
 *  - `biggest.wins.away` is a score as the match was written, home side
 *    first ("1-4" is a 4-1 win away); it is turned to the team's side here.
 *  - `form` is oldest first.
 *
 * Field names below are API-Football's (including `loses`). None of them leave
 * this directory.
 */

import type {
  EntityRef,
  HomeAway,
  MinuteBand,
  NormalisedTeamSeasonStats,
  TeamScore,
} from '../../normalised';
import { decodeEntities } from '../../news/feed';
import { isRecord, type Json } from './map';

const rec = (value: unknown): Json => (isRecord(value) ? value : {});

/** A count: a whole number, zero or more. Anything else was not supplied. */
const count = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;

const id = (value: unknown): string | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? String(value) : null;

function entity(value: unknown): EntityRef | null {
  const v = rec(value);
  const externalId = id(v.id);
  if (externalId === null || typeof v.name !== 'string') return null;
  const name = decodeEntities(v.name).replace(/\s+/g, ' ').trim();
  return /\p{L}/u.test(name) ? { externalId, name } : null;
}

const homeAway = (value: unknown): HomeAway => {
  const v = rec(value);
  return { home: count(v.home), away: count(v.away) };
};

/**
 * How far the minute bands may miss the provider's own goal total and still
 * be shown: the larger of two goals and a tenth of the total. A league's bands
 * miss by one or two; a cup's with a shoot-out by the shoot-out.
 */
export function bandTolerance(total: number): number {
  return Math.max(2, Math.round(total / 10));
}

/** "0-15" → {from: 0, to: 15}; anything else is not a band. */
function bandOf(key: string): { from: number; to: number } | null {
  const m = /^(\d{1,3})-(\d{1,3})$/.exec(key);
  if (m === null) return null;
  const from = Number(m[1]);
  const to = Number(m[2]);
  return to > from ? { from, to } : null;
}

/**
 * The bands that carry a goal, in minute order; a band the provider wrote as
 * `null` is a band without one. `null` for no band at all.
 */
export function minuteBands(value: unknown): MinuteBand[] | null {
  if (!isRecord(value)) return null;
  const bands: MinuteBand[] = [];
  let read = 0;
  for (const [key, entry] of Object.entries(value)) {
    const band = bandOf(key);
    if (band === null) continue;
    read += 1;
    const goals = count(rec(entry).total);
    if (goals !== null && goals > 0) bands.push({ ...band, goals });
  }
  if (read === 0) return null;
  return bands.sort((a, b) => a.from - b.from);
}

const bandSum = (bands: MinuteBand[]): number => bands.reduce((s, b) => s + b.goals, 0);

/** Whether the bands add up, within the tolerance, to the goals scored or conceded. */
export function bandsAddUp(bands: MinuteBand[] | null, goals: HomeAway): boolean {
  if (bands === null || goals.home === null || goals.away === null) return false;
  const total = goals.home + goals.away;
  return Math.abs(bandSum(bands) - total) <= bandTolerance(total);
}

/** "4-2" → [4, 2]; anything else is `null`. */
function scoreline(value: unknown): [number, number] | null {
  if (typeof value !== 'string') return null;
  const m = /^\s*(\d{1,2})\s*-\s*(\d{1,2})\s*$/.exec(value);
  return m === null ? null : [Number(m[1]), Number(m[2])];
}

/**
 * A biggest win or defeat from the team's side. The provider writes the
 * match's score, home side first, so away the two are turned round. A
 * "win" that is not won, or a "defeat" that is not lost, is not a score we
 * can believe and is left out.
 */
export function teamScore(value: unknown, venue: 'home' | 'away', won: boolean): TeamScore | null {
  const s = scoreline(value);
  if (s === null) return null;
  const score = venue === 'home' ? { for: s[0], against: s[1] } : { for: s[1], against: s[0] };
  return (won ? score.for > score.against : score.for < score.against) ? score : null;
}

/** The form as W, D and L only; anything else in it, and an empty form, is not supplied. */
function form(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim().toUpperCase();
  return /^[WDL]+$/.test(text) ? text : null;
}

/** Formations with a count, most used first; one listed twice is counted once, summed. */
function formations(value: unknown): { formation: string; played: number }[] {
  if (!Array.isArray(value)) return [];
  const byName = new Map<string, number>();
  for (const item of value) {
    const it = rec(item);
    const name = typeof it.formation === 'string' ? it.formation.trim() : '';
    const played = count(it.played);
    if (!/^\d(-\d){1,4}$/.test(name) || played === null || played === 0) continue;
    byName.set(name, (byName.get(name) ?? 0) + played);
  }
  return [...byName.entries()]
    .map(([formation, played]) => ({ formation, played }))
    .sort((a, b) => b.played - a.played || a.formation.localeCompare(b.formation));
}

/**
 * `/teams/statistics`: the team's season in one competition (the answer's
 * object, or a list of it), or `null` when
 * the answer is not for the team, competition and season asked about, or
 * the team played no match in it (the provider answers with a season of
 * zeros then, which is not a season's statistics).
 */
export function mapTeamSeasonStats(
  response: unknown,
  ask: { competitionExternalId: string; teamExternalId: string; seasonYear: number },
): NormalisedTeamSeasonStats | null {
  if (Array.isArray(response)) return mapTeamSeasonStats(response[0], ask);
  if (!isRecord(response)) return null;
  const league = rec(response.league);
  const competition = entity(league);
  const team = entity(response.team);
  if (competition === null || team === null) return null;
  if (competition.externalId !== ask.competitionExternalId) return null;
  if (team.externalId !== ask.teamExternalId) return null;
  if (league.season !== undefined && league.season !== ask.seasonYear) return null;

  const fixtures = rec(response.fixtures);
  const played = homeAway(fixtures.played);
  if ((played.home ?? 0) + (played.away ?? 0) === 0) return null;

  const goals = rec(response.goals);
  const goalsForBlock = rec(goals.for);
  const goalsAgainstBlock = rec(goals.against);
  const goalsFor = homeAway(goalsForBlock.total);
  const goalsAgainst = homeAway(goalsAgainstBlock.total);
  const forBands = minuteBands(goalsForBlock.minute);
  const againstBands = minuteBands(goalsAgainstBlock.minute);
  // A band set that misses its own total says the provider counted something
  // that is not a goal -- a shoot-out -- and then the penalties count it too.
  const bandsWithheld =
    (forBands !== null && !bandsAddUp(forBands, goalsFor)) ||
    (againstBands !== null && !bandsAddUp(againstBands, goalsAgainst));
  const penalty = rec(response.penalty);
  const biggest = rec(response.biggest);
  const wins = rec(biggest.wins);
  const loses = rec(biggest.loses);
  const streak = rec(biggest.streak);

  return {
    competition,
    team,
    seasonYear: ask.seasonYear,
    played,
    wins: homeAway(fixtures.wins),
    draws: homeAway(fixtures.draws),
    losses: homeAway(fixtures.loses),
    goalsFor,
    goalsAgainst,
    cleanSheets: homeAway(response.clean_sheet),
    failedToScore: homeAway(response.failed_to_score),
    form: form(response.form),
    goalsForByMinute: bandsWithheld ? null : forBands,
    goalsAgainstByMinute: bandsWithheld ? null : againstBands,
    bandsWithheld,
    penaltiesScored: bandsWithheld ? null : count(rec(penalty.scored).total),
    penaltiesMissed: bandsWithheld ? null : count(rec(penalty.missed).total),
    biggestWin: {
      home: teamScore(wins.home, 'home', true),
      away: teamScore(wins.away, 'away', true),
    },
    biggestDefeat: {
      home: teamScore(loses.home, 'home', false),
      away: teamScore(loses.away, 'away', false),
    },
    longestRun: {
      wins: count(streak.wins),
      draws: count(streak.draws),
      losses: count(streak.loses),
    },
    formations: formations(response.lineups),
  };
}
