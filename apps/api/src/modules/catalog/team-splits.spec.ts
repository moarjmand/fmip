import type { TeamSplitRecord } from '@fmip/contracts';
import { describe, expect, it } from 'vitest';
import { averages, buildSplits, type SplitFixture } from './internal/team-splits';
import type { TeamSeason } from './internal/team-store';

// T-632: a team's figures home, away and in total per competition, from
// stored finished fixtures only. A shoot-out is not a result; an average is
// never taken over some of the matches and shown as if over all of them.

const LEAGUE: TeamSeason = {
  competition: { id: 'league', name: 'League', short_name: null },
  season: { id: 's-league', label: '2025/26', is_current: true },
};
const CUP: TeamSeason = {
  competition: { id: 'cup', name: 'Cup', short_name: null },
  season: { id: 's-cup', label: '2025/26', is_current: true },
};

let seq = 0;
function match(
  side: 'home' | 'away',
  score: [number, number] | null,
  over: Partial<SplitFixture> = {},
): SplitFixture {
  seq += 1;
  return {
    season_id: LEAGUE.season.id,
    side,
    score: score === null ? null : { for: score[0], against: score[1] },
    penalties: false,
    stats: {},
    updated_at: `2025-09-${String(seq).padStart(2, '0')}T17:00:00.000Z`,
    ...over,
  };
}

function sum(a: TeamSplitRecord, b: TeamSplitRecord): TeamSplitRecord {
  return {
    played: a.played + b.played,
    won: a.won + b.won,
    drawn: a.drawn + b.drawn,
    lost: a.lost + b.lost,
    goals_for: a.goals_for + b.goals_for,
    goals_against: a.goals_against + b.goals_against,
    clean_sheets: a.clean_sheets + b.clean_sheets,
  };
}

describe('buildSplits', () => {
  it('counts home and away separately, and home plus away is the total', () => {
    const [league] = buildSplits(
      [LEAGUE],
      [
        match('home', [2, 0]),
        match('home', [1, 1]),
        match('away', [0, 3]),
        match('away', [2, 1]),
        match('away', [0, 0]),
      ],
    );
    expect(league!.home).toEqual({
      played: 2,
      won: 1,
      drawn: 1,
      lost: 0,
      goals_for: 3,
      goals_against: 1,
      clean_sheets: 1,
    });
    expect(league!.away).toEqual({
      played: 3,
      won: 1,
      drawn: 1,
      lost: 1,
      goals_for: 2,
      goals_against: 4,
      clean_sheets: 1,
    });
    expect(league!.total).toEqual(sum(league!.home, league!.away));
    expect(league!.last_updated_at).toBe(`2025-09-${String(seq).padStart(2, '0')}T17:00:00.000Z`);
  });

  it('counts a tie settled on penalties as a draw and leaves the shoot-out out of the goals', () => {
    const [, cup] = buildSplits(
      [LEAGUE, CUP],
      [
        match('away', [1, 1], { season_id: CUP.season.id, penalties: true }),
        match('home', [3, 2], { season_id: CUP.season.id }),
      ],
    );
    expect(cup!.competition.id).toBe('cup');
    expect(cup!.total).toMatchObject({
      played: 2,
      won: 1,
      drawn: 1,
      lost: 0,
      goals_for: 4,
      goals_against: 3,
    });
    expect(cup!.away.drawn).toBe(1);
    expect(cup!.penalty_shootouts).toBe(1);
  });

  it('keeps one entry per season in order, zeros for a competition with nothing finished', () => {
    const splits = buildSplits([LEAGUE, CUP], [match('home', [1, 0])]);
    expect(splits.map((s) => s.competition.id)).toEqual(['league', 'cup']);
    expect(splits[1]!.total.played).toBe(0);
    expect(splits[1]!.averages).toEqual([]);
    expect(splits[1]!.last_updated_at).toBeNull();
  });

  it('never counts a finished match without a score, and says how many there are', () => {
    const [league] = buildSplits([LEAGUE], [match('home', [1, 0]), match('away', null)]);
    expect(league!.total.played).toBe(1);
    expect(league!.away.played).toBe(0);
    expect(league!.finished_without_score).toBe(1);
  });
});

describe('averages', () => {
  it('averages a metric every counted match holds, per split', () => {
    const result = averages([
      match('home', [1, 0], { stats: { shots: 12 } }),
      match('home', [1, 0], { stats: { shots: 9 } }),
      match('away', [0, 1], { stats: { shots: 7 } }),
    ]);
    const shots = result.find((a) => a.metric === 'shots')!;
    expect(shots).toEqual({
      metric: 'shots',
      coverage: 'available',
      matches_with_figure: { home: 2, away: 1, total: 3 },
      home: 10.5,
      away: 7,
      total: 9.33,
    });
  });

  it('gives no average for a split with a match that lacks the figure: limited, not partial', () => {
    const result = averages([
      match('home', [1, 0], { stats: { possession_pct: 60 } }),
      match('home', [1, 0], { stats: { possession_pct: 50 } }),
      match('away', [0, 1], { stats: { possession_pct: 40 } }),
      match('away', [0, 1]),
    ]);
    const possession = result.find((a) => a.metric === 'possession_pct')!;
    expect(possession.coverage).toBe('limited');
    expect(possession.home).toBe(55);
    expect(possession.away).toBeNull();
    expect(possession.total).toBeNull();
    expect(possession.matches_with_figure).toEqual({ home: 2, away: 1, total: 3 });
  });

  it('says not_supplied for a metric no counted match holds, and keeps every metric row', () => {
    const result = averages([match('home', [1, 0], { stats: { corners: 5 } })]);
    const xg = result.find((a) => a.metric === 'expected_goals')!;
    expect(xg).toMatchObject({ coverage: 'not_supplied', home: null, away: null, total: null });
    // No away match: that split is null although the metric is complete.
    const corners = result.find((a) => a.metric === 'corners')!;
    expect(corners).toMatchObject({ coverage: 'available', home: 5, away: null, total: 5 });
    expect(result).toHaveLength(7);
  });
});
