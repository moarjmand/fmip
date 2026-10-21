import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Transport, TransportResponse } from '../_contract';
import { createApiFootballAdapter } from './index';
import {
  bandTolerance,
  bandsAddUp,
  mapTeamSeasonStats,
  minuteBands,
  teamScore,
} from './team-statistics';

// Recorded read-only on the Ultra plan, 2026-10-21 (T-1437): see the files' `note`.
const DIR = join(__dirname, '..', '_fixtures', 'api-football-team-statistics');
function recorded(name: string): { url: string; body: { response: unknown } } {
  const file = JSON.parse(readFileSync(join(DIR, `${name}.json`), 'utf8')) as {
    requests: { url: string; body: { response: unknown } }[];
  };
  return file.requests[0]!;
}
const LEAGUE_2025 = recorded('premier-league-2025-manchester-united');
const LEAGUE_2020 = recorded('premier-league-2020-manchester-united');
const CUP_2024 = recorded('fa-cup-2024-manchester-united');

const ask = (competitionExternalId: string, seasonYear: number) => ({
  competitionExternalId,
  teamExternalId: '33',
  seasonYear,
});

describe('mapTeamSeasonStats (T-1437), recorded', () => {
  it('reads a league season whole', () => {
    const s = mapTeamSeasonStats(LEAGUE_2025.body.response, ask('39', 2025));
    expect(s).not.toBeNull();
    expect(s!.competition).toEqual({ externalId: '39', name: 'Premier League' });
    expect(s!.team).toEqual({ externalId: '33', name: 'Manchester United' });
    expect(s!.played).toEqual({ home: 19, away: 19 });
    expect(s!.wins).toEqual({ home: 13, away: 7 });
    expect(s!.draws).toEqual({ home: 3, away: 8 });
    expect(s!.losses).toEqual({ home: 3, away: 4 });
    expect(s!.goalsFor).toEqual({ home: 39, away: 30 });
    expect(s!.goalsAgainst).toEqual({ home: 24, away: 26 });
    expect(s!.cleanSheets).toEqual({ home: 4, away: 4 });
    expect(s!.failedToScore).toEqual({ home: 2, away: 2 });
    expect(s!.form).toHaveLength(38);
    expect(s!.form!.endsWith('WW')).toBe(true);
    // 68 in the bands for 69 scored: within the tolerance, so shown.
    expect(s!.bandsWithheld).toBe(false);
    expect(s!.goalsForByMinute).toEqual([
      { from: 0, to: 15, goals: 9 },
      { from: 16, to: 30, goals: 7 },
      { from: 31, to: 45, goals: 14 },
      { from: 46, to: 60, goals: 12 },
      { from: 61, to: 75, goals: 10 },
      { from: 76, to: 90, goals: 16 },
    ]);
    expect(s!.penaltiesScored).toBe(4);
    expect(s!.penaltiesMissed).toBe(0);
    // "1-4" away is a 4-1 win; "3-0" away a 0-3 defeat.
    expect(s!.biggestWin).toEqual({
      home: { for: 4, against: 2 },
      away: { for: 4, against: 1 },
    });
    expect(s!.biggestDefeat).toEqual({
      home: { for: 1, against: 2 },
      away: { for: 0, against: 3 },
    });
    expect(s!.longestRun).toEqual({ wins: 4, draws: 3, losses: 1 });
    expect(s!.formations).toEqual([
      { formation: '4-2-3-1', played: 20 },
      { formation: '3-4-2-1', played: 18 },
    ]);
  });

  it('reads a past season, with a defeat it never had away left out', () => {
    const s = mapTeamSeasonStats(LEAGUE_2020.body.response, ask('39', 2020));
    expect(s!.seasonYear).toBe(2020);
    expect(s!.biggestWin.home).toEqual({ for: 9, against: 0 });
    expect(s!.biggestDefeat).toEqual({ home: { for: 1, against: 6 }, away: null });
    expect(s!.losses).toEqual({ home: 6, away: 0 });
  });

  it("leaves out a cup's minute bands and penalties that count shoot-out kicks", () => {
    const s = mapTeamSeasonStats(CUP_2024.body.response, ask('45', 2024));
    expect(s!.goalsFor).toEqual({ home: 3, away: 1 });
    expect(s!.bandsWithheld).toBe(true);
    expect(s!.goalsForByMinute).toBeNull();
    expect(s!.goalsAgainstByMinute).toBeNull();
    expect(s!.penaltiesScored).toBeNull();
    expect(s!.penaltiesMissed).toBeNull();
    // The rest of the season stands.
    expect(s!.biggestWin).toEqual({ home: { for: 2, against: 1 }, away: null });
    expect(s!.form).toBe('DWD');
  });

  it('answers null for another team, competition or season than asked', () => {
    const r = LEAGUE_2025.body.response;
    expect(mapTeamSeasonStats(r, { ...ask('39', 2025), teamExternalId: '40' })).toBeNull();
    expect(mapTeamSeasonStats(r, ask('45', 2025))).toBeNull();
    expect(mapTeamSeasonStats(r, ask('39', 2024))).toBeNull();
  });

  it('answers null for no statistics: an empty list, or a season of no match', () => {
    expect(mapTeamSeasonStats([], ask('39', 2025))).toBeNull();
    const none = structuredClone(LEAGUE_2025.body.response) as { fixtures: { played: unknown } };
    none.fixtures.played = { home: 0, away: 0, total: 0 };
    expect(mapTeamSeasonStats(none, ask('39', 2025))).toBeNull();
  });

  it('keeps a missing count missing, never zero', () => {
    const r = structuredClone(LEAGUE_2025.body.response) as Record<string, unknown>;
    r.clean_sheet = { home: null, away: 4, total: null };
    r.form = null;
    r.lineups = [
      { formation: 'x', played: 3 },
      { formation: '4-4-2', played: null },
    ];
    const s = mapTeamSeasonStats(r, ask('39', 2025))!;
    expect(s.cleanSheets).toEqual({ home: null, away: 4 });
    expect(s.form).toBeNull();
    expect(s.formations).toEqual([]);
  });
});

describe('the pieces', () => {
  it('tolerates two goals, or a tenth of many', () => {
    expect(bandTolerance(4)).toBe(2);
    expect(bandTolerance(69)).toBe(7);
  });

  it('reads bands in minute order, a null band as none', () => {
    expect(minuteBands({ '16-30': { total: 2 }, '0-15': { total: null }, odd: {} })).toEqual([
      { from: 16, to: 30, goals: 2 },
    ]);
    expect(minuteBands(null)).toBeNull();
    expect(minuteBands({})).toBeNull();
  });

  it('checks the bands against the totals', () => {
    const bands = [{ from: 0, to: 15, goals: 12 }];
    expect(bandsAddUp(bands, { home: 3, away: 1 })).toBe(false);
    expect(bandsAddUp(bands, { home: 6, away: 5 })).toBe(true);
    expect(bandsAddUp(bands, { home: null, away: 5 })).toBe(false);
  });

  it("turns an away score to the team's side, and refuses a win that is not", () => {
    expect(teamScore('1-4', 'away', true)).toEqual({ for: 4, against: 1 });
    expect(teamScore('4-1', 'away', true)).toBeNull();
    expect(teamScore('2-2', 'home', false)).toBeNull();
    expect(teamScore(null, 'home', true)).toBeNull();
  });
});

describe('getTeamSeasonStats (T-1437)', () => {
  class Scripted implements Transport {
    readonly urls: string[] = [];
    constructor(private readonly answers: TransportResponse[]) {}
    request(url: string): Promise<TransportResponse> {
      this.urls.push(url);
      const next = this.answers.shift();
      if (next === undefined) throw new Error(`unscripted request ${url}`);
      return Promise.resolve(next);
    }
  }

  it('asks once, by league, season and team', async () => {
    const transport = new Scripted([
      { status: 200, body: LEAGUE_2025.body, receivedAt: '2026-10-21T10:00:00.000Z' },
    ]);
    const adapter = createApiFootballAdapter(transport, { apiKey: 'k' });
    const r = await adapter.getTeamSeasonStats!('39', '2025/26', '33');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.requests).toBe(1);
    expect(r.fetchedAt).toBe('2026-10-21T10:00:00.000Z');
    expect(r.data?.played).toEqual({ home: 19, away: 19 });
    const url = new URL(transport.urls[0]!);
    expect(url.pathname).toBe('/teams/statistics');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      league: '39',
      season: '2025',
      team: '33',
    });
  });

  it('refuses a season label it cannot read, without asking', async () => {
    const transport = new Scripted([]);
    const adapter = createApiFootballAdapter(transport, { apiKey: 'k' });
    const r = await adapter.getTeamSeasonStats!('39', 'spring', '33');
    expect(r).toMatchObject({ ok: false, requests: 0, error: { kind: 'unsupported' } });
    expect(transport.urls).toEqual([]);
  });
});
