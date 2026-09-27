import {
  TEAM_AVERAGE_METRICS,
  type TeamAverageMetric,
  type TeamCompetitionSplits,
  type TeamSplitRecord,
  type TeamStatAverage,
} from '@fmip/contracts';
import type { TeamSeason } from './team-store';

/**
 * One finished fixture of the team as the splits read it (T-632): which side
 * it was on, the score after extra time where one was played (null when we
 * hold none), whether a shoot-out followed, and the team's own statistics.
 */
export interface SplitFixture {
  season_id: string;
  side: 'home' | 'away';
  score: { for: number; against: number } | null;
  penalties: boolean;
  /** Only the metrics we hold a row for; an absent key is not supplied. */
  stats: Partial<Record<TeamAverageMetric, number>>;
  updated_at: string;
}

type Split = 'home' | 'away' | 'total';
const SPLITS: readonly Split[] = ['home', 'away', 'total'];

function emptyRecord(): TeamSplitRecord {
  return {
    played: 0,
    won: 0,
    drawn: 0,
    lost: 0,
    goals_for: 0,
    goals_against: 0,
    clean_sheets: 0,
  };
}

function add(record: TeamSplitRecord, score: { for: number; against: number }): void {
  record.played += 1;
  // A shoot-out decides a tie, not the match: level after extra time is a
  // draw here, whoever went through.
  if (score.for > score.against) record.won += 1;
  else if (score.for === score.against) record.drawn += 1;
  else record.lost += 1;
  record.goals_for += score.for;
  record.goals_against += score.against;
  if (score.against === 0) record.clean_sheets += 1;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/**
 * The averages over the counted matches: a split is averaged only when every
 * one of its matches holds the figure (rule 3 — a partial average is never
 * shown as a complete one).
 */
export function averages(counted: readonly SplitFixture[]): TeamStatAverage[] {
  if (counted.length === 0) return [];
  return TEAM_AVERAGE_METRICS.map((metric) => {
    const bySplit = {} as Record<Split, { matches: number; held: number; sum: number }>;
    for (const split of SPLITS) {
      const matches = counted.filter((f) => split === 'total' || f.side === split);
      const held = matches.filter((f) => f.stats[metric] !== undefined);
      bySplit[split] = {
        matches: matches.length,
        held: held.length,
        sum: held.reduce((s, f) => s + (f.stats[metric] ?? 0), 0),
      };
    }
    const value = (split: Split): number | null => {
      const s = bySplit[split];
      return s.matches > 0 && s.held === s.matches ? round2(s.sum / s.matches) : null;
    };
    const total = bySplit.total;
    return {
      metric,
      coverage:
        total.held === 0 ? 'not_supplied' : total.held === total.matches ? 'available' : 'limited',
      matches_with_figure: {
        home: bySplit.home.held,
        away: bySplit.away.held,
        total: total.held,
      },
      home: value('home'),
      away: value('away'),
      total: value('total'),
    };
  });
}

/**
 * The team's figures per competition season, one entry per `seasons` entry
 * and in its order, from finished fixtures only. Home plus away is the total
 * by construction: every counted match is exactly one of the two.
 */
export function buildSplits(
  seasons: readonly TeamSeason[],
  fixtures: readonly SplitFixture[],
): TeamCompetitionSplits[] {
  return seasons.map((s) => {
    const mine = fixtures.filter((f) => f.season_id === s.season.id);
    const counted = mine.filter((f) => f.score !== null);
    const home = emptyRecord();
    const away = emptyRecord();
    const total = emptyRecord();
    let last: string | null = null;
    for (const f of counted) {
      const score = f.score!;
      add(f.side === 'home' ? home : away, score);
      add(total, score);
      if (last === null || f.updated_at > last) last = f.updated_at;
    }
    return {
      competition: s.competition,
      season: s.season,
      home,
      away,
      total,
      penalty_shootouts: counted.filter((f) => f.penalties && f.score!.for === f.score!.against)
        .length,
      finished_without_score: mine.length - counted.length,
      averages: averages(counted),
      last_updated_at: last,
    };
  });
}
