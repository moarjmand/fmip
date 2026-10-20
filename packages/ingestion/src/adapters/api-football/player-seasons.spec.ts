import { describe, expect, it } from 'vitest';
import type { TransportResponse } from '../_contract';
import { createApiFootballAdapter } from './index';
import { mapPlayerCareer, mapPlayerSeason, seasonRating } from './player-seasons';

// CONSTRUCTED, not recorded: the shapes of `/players?id=&season=` and
// `/players/teams?player=` as API-Football documents them. No answer from
// these endpoints has been recorded (`_fixtures/README.md`: recordings are
// never invented, so these bodies live here and not there). The ids are
// invented; the numbers are plausible, not a real player's.

function block(over: {
  league?: unknown;
  team?: unknown;
  games?: Record<string, unknown>;
  goals?: Record<string, unknown>;
  cards?: Record<string, unknown>;
}): Record<string, unknown> {
  return {
    team: over.team ?? { id: 40, name: 'Liverpool', logo: 'https://example.test/t/40.png' },
    league: over.league ?? {
      id: 39,
      name: 'Premier League',
      country: 'England',
      logo: 'https://example.test/l/39.png',
      flag: 'https://example.test/f/gb.svg',
      season: 2026,
    },
    games: {
      appearences: 9,
      lineups: 8,
      minutes: 731,
      number: null,
      position: 'Attacker',
      rating: '7.433333',
      captain: false,
      ...over.games,
    },
    substitutes: { in: 1, out: 4, bench: 1 },
    shots: { total: 30, on: 14 },
    goals: { total: 6, conceded: 0, assists: 3, saves: null, ...over.goals },
    passes: { total: 300, key: 20, accuracy: 25 },
    tackles: { total: 4, blocks: null, interceptions: 2 },
    duels: { total: 60, won: 28 },
    dribbles: { attempts: 25, success: 12, past: null },
    fouls: { drawn: 9, committed: 3 },
    cards: { yellow: 1, yellowred: 0, red: 0, ...over.cards },
    penalty: { won: null, commited: null, scored: 2, missed: 0, saved: null },
  };
}

const seasonBody = {
  get: 'players',
  parameters: { id: '90001', season: '2026' },
  errors: [],
  results: 1,
  paging: { current: 1, total: 1 },
  response: [
    {
      player: { id: 90001, name: 'A. Example', firstname: 'Alan', lastname: 'Example' },
      statistics: [
        block({}),
        block({
          league: { id: 2, name: 'UEFA Champions League', country: 'World', season: 2026 },
          games: { appearences: 3, lineups: 3, minutes: 270, rating: '7.9' },
          goals: { total: 2, assists: null },
        }),
        // Named on the bench for the cup tie, never on the pitch: no line.
        block({
          league: { id: 48, name: 'League Cup', country: 'England', season: 2026 },
          games: { appearences: 0, lineups: 0, minutes: 0, rating: null },
        }),
        // National team, the same season year.
        block({
          team: { id: 32, name: 'Egypt' },
          league: { id: 29, name: 'World Cup - Qualification Africa', season: 2026 },
          games: { appearences: 2, lineups: 2, minutes: 180, rating: null },
          goals: { total: 1, assists: 1 },
          cards: { yellow: null, yellowred: null, red: null },
        }),
      ],
    },
  ],
};

const careerBody = {
  get: 'players/teams',
  parameters: { player: '90001' },
  errors: [],
  results: 3,
  paging: { current: 1, total: 1 },
  response: [
    {
      team: { id: 40, name: 'Liverpool', logo: 'https://example.test/t/40.png' },
      seasons: [2026, 2025, 2024, 2017],
    },
    { team: { id: 497, name: 'AS Roma' }, seasons: [2016, 2015] },
    { team: { id: 32, name: 'Egypt' }, seasons: [2026, 2025, 2011] },
  ],
};

function adapterAnswering(body: unknown, asked: string[] = []) {
  return createApiFootballAdapter(
    {
      request: async (url): Promise<TransportResponse> => {
        asked.push(url);
        return { status: 200, body, receivedAt: '2026-10-20T00:00:00Z' };
      },
    },
    { apiKey: 'test-key' },
  );
}

describe("a player's season in every competition (T-1431)", () => {
  it('asks once, by player and season year, and maps a line per competition and team', async () => {
    const asked: string[] = [];
    const result = await adapterAnswering(seasonBody, asked).getPlayerSeason!('90001', '2026/27');
    expect(asked).toEqual(['https://v3.football.api-sports.io/players?id=90001&season=2026']);
    expect(result).toMatchObject({ ok: true, requests: 1, fetchedAt: '2026-10-20T00:00:00Z' });
    if (!result.ok) return;
    expect(result.data.map((l) => `${l.competition.externalId}/${l.team.externalId}`)).toEqual([
      '39/40',
      '2/40',
      '29/32',
    ]);
    expect(result.data[0]).toEqual({
      competition: { externalId: '39', name: 'Premier League' },
      team: { externalId: '40', name: 'Liverpool' },
      seasonYear: 2026,
      appearances: 9,
      starts: 8,
      minutes: 731,
      goals: 6,
      assists: 3,
      yellowCards: 1,
      secondYellowCards: 0,
      redCards: 0,
      saves: null,
      goalsConceded: null,
      rating: 7.43,
    });
  });

  it('keeps a count the provider left out as null, never zero', () => {
    const lines = mapPlayerSeason(seasonBody.response, '90001', 2026);
    expect(lines[1]).toMatchObject({ assists: null, goals: 2 });
    expect(lines[2]).toMatchObject({
      yellowCards: null,
      secondYellowCards: null,
      redCards: null,
      rating: null,
    });
  });

  it('keeps saves and goals conceded for a goalkeeper only', () => {
    const keeper = {
      player: { id: 90002 },
      statistics: [
        block({
          games: { position: 'Goalkeeper' },
          goals: { total: 0, conceded: 11, saves: 37, assists: 0 },
        }),
      ],
    };
    expect(mapPlayerSeason([keeper], '90002', 2026)[0]).toMatchObject({
      saves: 37,
      goalsConceded: 11,
    });
    // The outfield player's `conceded: 0` is not his.
    expect(mapPlayerSeason(seasonBody.response, '90001', 2026)[0]).toMatchObject({
      saves: null,
      goalsConceded: null,
    });
  });

  it('leaves out another player, another season, a nameless block and a repeat', () => {
    expect(mapPlayerSeason(seasonBody.response, '1', 2026)).toEqual([]);
    expect(mapPlayerSeason(seasonBody.response, '90001', 2025)).toEqual([]);
    expect(mapPlayerSeason(null, '90001', 2026)).toEqual([]);
    const odd = {
      player: { id: 90001 },
      statistics: [
        block({ league: { id: 39, name: '   ', season: 2026 } }),
        block({ team: { id: null, name: 'Liverpool' } }),
        block({ games: { appearences: null } }),
        block({}),
        block({ games: { appearences: 1 } }),
      ],
    };
    const lines = mapPlayerSeason([odd], '90001', 2026);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.appearances).toBe(9);
  });

  it('reads a rating only between 0 and 10, to two places', () => {
    expect(seasonRating('6.8571')).toBe(6.86);
    expect(seasonRating(7)).toBe(7);
    expect(seasonRating('0')).toBeNull();
    expect(seasonRating('11.2')).toBeNull();
    expect(seasonRating('n/a')).toBeNull();
    expect(seasonRating(null)).toBeNull();
  });

  it('answers unsupported without a request for a season it cannot read', async () => {
    const asked: string[] = [];
    const result = await adapterAnswering(seasonBody, asked).getPlayerSeason!('90001', 'next');
    expect(asked).toEqual([]);
    expect(result).toMatchObject({ ok: false, requests: 0, error: { kind: 'unsupported' } });
  });

  it('counts a refusal as one request', async () => {
    const result = await adapterAnswering({
      errors: { rateLimit: 'Too many requests' },
      response: [],
    }).getPlayerSeason!('90001', '2026');
    expect(result).toMatchObject({ ok: false, requests: 1, error: { kind: 'quota' } });
  });
});

describe("a player's career (T-1431)", () => {
  it('asks once, by player, and lists each team with its season years, newest first', async () => {
    const asked: string[] = [];
    const result = await adapterAnswering(careerBody, asked).getPlayerCareer!('90001');
    expect(asked).toEqual(['https://v3.football.api-sports.io/players/teams?player=90001']);
    expect(result).toMatchObject({ ok: true, requests: 1 });
    expect(result.ok && result.data).toEqual([
      { team: { externalId: '40', name: 'Liverpool' }, seasonYears: [2026, 2025, 2024, 2017] },
      { team: { externalId: '32', name: 'Egypt' }, seasonYears: [2026, 2025, 2011] },
      { team: { externalId: '497', name: 'AS Roma' }, seasonYears: [2016, 2015] },
    ]);
  });

  it('merges a team listed twice and drops one without a readable season or name', () => {
    expect(
      mapPlayerCareer([
        { team: { id: 497, name: 'AS Roma' }, seasons: [2015] },
        { team: { id: 497, name: 'AS Roma' }, seasons: [2016, 2015, '2014'] },
        { team: { id: 8, name: 'Basel' }, seasons: [] },
        { team: { id: 9, name: 'Nowhere' }, seasons: [12, 3000] },
        { team: { id: 10, name: '' }, seasons: [2013] },
        { seasons: [2012] },
      ]),
    ).toEqual([{ team: { externalId: '497', name: 'AS Roma' }, seasonYears: [2016, 2015] }]);
    expect(mapPlayerCareer('nothing')).toEqual([]);
  });
});
