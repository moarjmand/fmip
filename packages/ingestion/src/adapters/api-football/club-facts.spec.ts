import { describe, expect, it } from 'vitest';
import type { TransportResponse } from '../_contract';
import { mapTeamFacts, mapVenue, venueSurface } from './club-facts';
import { createApiFootballAdapter } from './index';
import { refereeName } from './map';

// The entries below are copied from answers production's key received on
// 2026-10-21 (read-only `/teams?league=39&season=2025`, `/venues?id=556`),
// trimmed to the fields read; the malformed entries are written for the spec.

const oldTrafford = {
  id: 556,
  name: 'Old Trafford',
  address: 'Sir Matt Busby Way',
  city: 'Manchester',
  capacity: 76212,
  surface: 'grass',
  image: 'https://media.api-sports.io/football/venues/556.png',
};

const teamsBody = {
  get: 'teams',
  parameters: { league: '39', season: '2025' },
  errors: [],
  results: 2,
  paging: { current: 1, total: 1 },
  response: [
    {
      team: {
        id: 33,
        name: 'Manchester United',
        code: 'MUN',
        country: 'England',
        founded: 1878,
        national: false,
        logo: 'https://media.api-sports.io/football/teams/33.png',
      },
      venue: oldTrafford,
    },
    {
      team: {
        id: 34,
        name: 'Newcastle',
        code: 'NEW',
        country: 'England',
        founded: 1892,
        national: false,
        logo: 'https://media.api-sports.io/football/teams/34.png',
      },
      venue: {
        id: 562,
        name: "St. James' Park",
        address: 'St. James&apos; Street',
        city: 'Newcastle upon Tyne',
        capacity: 52758,
        surface: 'grass',
        image: 'https://media.api-sports.io/football/venues/562.png',
      },
    },
  ],
};

function adapterAnswering(body: unknown, asked: string[] = []) {
  return createApiFootballAdapter(
    {
      request: async (url): Promise<TransportResponse> => {
        asked.push(url);
        return { status: 200, body, receivedAt: '2026-10-21T00:00:00Z' };
      },
    },
    { apiKey: 'test-key' },
  );
}

describe("a season's teams (T-1438)", () => {
  it('asks once, by league and season year, and reads each team and its ground', async () => {
    const asked: string[] = [];
    const result = await adapterAnswering(teamsBody, asked).getSeasonTeams!({
      competitionExternalId: '39',
      seasonLabel: '2025/26',
    });
    expect(asked).toEqual(['https://v3.football.api-sports.io/teams?league=39&season=2025']);
    expect(result).toMatchObject({ ok: true, requests: 1, fetchedAt: '2026-10-21T00:00:00Z' });
    expect(result.ok && result.data).toEqual([
      {
        team: {
          externalId: '33',
          name: 'Manchester United',
          imageUrl: 'https://media.api-sports.io/football/teams/33.png',
        },
        national: false,
        foundedYear: 1878,
        venue: {
          externalId: '556',
          name: 'Old Trafford',
          city: 'Manchester',
          address: 'Sir Matt Busby Way',
          capacity: 76212,
          surface: 'grass',
          imageUrl: 'https://media.api-sports.io/football/venues/556.png',
        },
      },
      {
        team: {
          externalId: '34',
          name: 'Newcastle',
          imageUrl: 'https://media.api-sports.io/football/teams/34.png',
        },
        national: false,
        foundedYear: 1892,
        venue: {
          externalId: '562',
          name: "St. James' Park",
          city: 'Newcastle upon Tyne',
          // The provider's entity, decoded.
          address: "St. James' Street",
          capacity: 52758,
          surface: 'grass',
          imageUrl: 'https://media.api-sports.io/football/venues/562.png',
        },
      },
    ]);
  });

  it('keeps unsaid or unreadable facts empty, never guessed', () => {
    expect(
      mapTeamFacts([
        {
          team: { id: 7, name: 'Example FC', founded: 1650, national: 'no' },
          venue: { id: 9, name: 'Ground', capacity: 0, surface: 'sand', image: 'http://x/y.png' },
        },
        { team: { id: 8, name: 'No Ground', founded: null }, venue: { id: null, name: null } },
        { team: { id: 7, name: 'Example FC' } },
        { team: { name: 'No id' } },
        'nothing',
      ]),
    ).toEqual([
      {
        team: { externalId: '7', name: 'Example FC' },
        national: null,
        foundedYear: null,
        venue: {
          externalId: '9',
          name: 'Ground',
          city: null,
          address: null,
          capacity: null,
          surface: null,
          imageUrl: null,
        },
      },
      {
        team: { externalId: '8', name: 'No Ground' },
        national: null,
        foundedYear: null,
        venue: null,
      },
    ]);
    expect(mapTeamFacts({ not: 'a list' })).toEqual([]);
  });

  it('answers unsupported without a request for a season it cannot read', async () => {
    const asked: string[] = [];
    const result = await adapterAnswering(teamsBody, asked).getSeasonTeams!({
      competitionExternalId: '39',
      seasonLabel: 'next',
    });
    expect(asked).toEqual([]);
    expect(result).toMatchObject({ ok: false, requests: 0, error: { kind: 'unsupported' } });
  });

  it('counts a refusal as one request', async () => {
    const result = await adapterAnswering({
      errors: { requests: 'limit reached for the day' },
      response: [],
    }).getSeasonTeams!({ competitionExternalId: '39', seasonLabel: '2025/26' });
    expect(result).toMatchObject({ ok: false, requests: 1, error: { kind: 'quota' } });
  });
});

describe('a venue (T-1438)', () => {
  it('asks once, by id, and reads the venue asked about', async () => {
    const asked: string[] = [];
    const result = await adapterAnswering(
      {
        get: 'venues',
        errors: [],
        results: 1,
        response: [{ ...oldTrafford, country: 'England' }],
      },
      asked,
    ).getVenue!('556');
    expect(asked).toEqual(['https://v3.football.api-sports.io/venues?id=556']);
    expect(result.ok && result.data).toMatchObject({
      externalId: '556',
      capacity: 76212,
      surface: 'grass',
    });
  });

  it('is null when the answer holds no entry for that venue', () => {
    expect(mapVenue([], '556')).toBeNull();
    expect(mapVenue([oldTrafford], '557')).toBeNull();
    expect(mapVenue('nothing', '556')).toBeNull();
  });

  it('reads the surface words it knows and no others', () => {
    expect(venueSurface('grass')).toBe('grass');
    expect(venueSurface('Grass')).toBe('grass');
    expect(venueSurface('artificial turf')).toBe('artificial');
    expect(venueSurface('Artificial turf')).toBe('artificial');
    expect(venueSurface('hybrid grass')).toBe('hybrid');
    expect(venueSurface('sand')).toBeNull();
    expect(venueSurface('')).toBeNull();
    expect(venueSurface(null)).toBeNull();
  });
});

describe('the referee (T-1438)', () => {
  it('is the name the provider wrote, without the country after a comma', () => {
    expect(refereeName('Anthony Taylor, England')).toBe('Anthony Taylor');
    expect(refereeName('M. Oliver')).toBe('M. Oliver');
    expect(refereeName('  Szymon   Marciniak ,  Poland ')).toBe('Szymon Marciniak');
    expect(refereeName('Clément Turpin')).toBe('Clément Turpin');
    expect(refereeName(', England')).toBeNull();
    expect(refereeName('')).toBeNull();
    expect(refereeName(null)).toBeNull();
    expect(refereeName(42)).toBeNull();
  });
});
