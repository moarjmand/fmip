import { createApiFootballAdapter, type Provider, type ProviderAdapter } from '@fmip/ingestion';
import { describe, expect, it } from 'vitest';
import {
  MAX_SQUADS_PER_DAY,
  SQUADS_PER_DAY,
  squadAllowance,
  squadsPerDay,
  sweepSquads,
  type SquadStore,
  type SquadTeam,
} from './squad-sweep';

// The squads sweep (T-1324) against the real API-Football adapter on a
// transport that answers CONSTRUCTED squads (not recorded: the documented
// shape of `/players/squads?team=`, with invented ids and addresses), and an
// in-memory store and media sink. The SQL behind the store is in
// `ingest-store.ts`; this spec is about what is asked and what is noted.

const NOW = new Date('2026-10-01T03:41:00Z');

function squadOf(teamId: string, players: [number, string | null][]): unknown {
  return {
    get: 'players/squads',
    errors: [],
    response: [
      {
        team: { id: Number(teamId), name: `Club ${teamId}` },
        players: players.map(([id, photo]) => ({
          id,
          name: `Player ${id}`,
          age: 25,
          number: null,
          position: 'Midfielder',
          ...(photo === null ? {} : { photo }),
        })),
      },
    ],
  };
}

const SQUADS: Record<string, unknown> = {
  '10': squadOf('10', [
    [101, 'https://example.test/players/101.png'],
    [102, 'https://example.test/players/102.png'],
    [103, null],
  ]),
  '20': squadOf('20', [
    [201, 'https://example.test/players/201.png'],
    [202, 'https://example.test/players/202.png'],
  ]),
};

function world(teams: SquadTeam[], options: { askedToday?: number; refuseAll?: boolean } = {}) {
  const requests: string[] = [];
  const adapter = createApiFootballAdapter(
    {
      request: async (url) => {
        requests.push(url);
        if (options.refuseAll === true) {
          return {
            status: 200,
            body: { errors: { requests: 'You have reached the request limit' }, response: [] },
            receivedAt: NOW.toISOString(),
          };
        }
        const team = new URL(url).searchParams.get('team') ?? '';
        return {
          status: 200,
          body: SQUADS[team] ?? { errors: [], response: [] },
          receivedAt: NOW.toISOString(),
        };
      },
    },
    { apiKey: 'test-key' },
  );
  // Persons we hold: 101 and 201. 102 and 202 are listed but never mapped.
  const mapped = new Map([
    ['101', 'person-101'],
    ['201', 'person-201'],
    ['103', 'person-103'],
  ]);
  const marked: { teamId: string; answered: boolean }[] = [];
  const dueLimits: number[] = [];
  const store: SquadStore = {
    squadsAskedSince: async () => options.askedToday ?? 0,
    squadsDue: async (_p, _s, _a, _b, limit) => {
      dueLimits.push(limit);
      return teams.slice(0, limit);
    },
    markSquadAsked: async (_p, teamId, answered) => {
      marked.push({ teamId, answered });
    },
    mappedPersons: async (_p, ids) =>
      new Map(ids.flatMap((id) => (mapped.has(id) ? [[id, mapped.get(id)!] as const] : []))),
  };
  const noted: { provider: Provider; entityId: string; url: string }[] = [];
  const media = {
    note: async (provider: Provider, _type: 'person', entityId: string, url: string) => {
      noted.push({ provider, entityId, url });
    },
  };
  return { adapter, store, media, requests, noted, marked, dueLimits };
}

const TEAMS: SquadTeam[] = [
  { teamId: 'team-10', externalId: '10' },
  { teamId: 'team-20', externalId: '20' },
];

const base = { provider: 'api_football' as const, seasonIds: ['s1'], now: NOW };

describe('the squads sweep (T-1324)', () => {
  it('notes the photos of mapped players only, spending one request per club', async () => {
    const w = world(TEAMS);
    const sweep = await sweepSquads({
      ...base,
      ...w,
      perDay: SQUADS_PER_DAY,
      budget: 7000,
      requestsToday: 100,
    });
    expect(w.requests).toEqual([
      'https://v3.football.api-sports.io/players/squads?team=10',
      'https://v3.football.api-sports.io/players/squads?team=20',
    ]);
    expect(sweep).toMatchObject({ asked: 2, answered: 2, listed: 5, noted: 2, refused: [] });
    // 102 and 202 are not ours and are not created; 103 has no photo.
    expect(w.noted).toEqual([
      {
        provider: 'api_football',
        entityId: 'person-101',
        url: 'https://example.test/players/101.png',
      },
      {
        provider: 'api_football',
        entityId: 'person-201',
        url: 'https://example.test/players/201.png',
      },
    ]);
    expect(w.marked).toEqual([
      { teamId: 'team-10', answered: true },
      { teamId: 'team-20', answered: true },
    ]);
  });

  it('asks no more than what is left of the day’s cap', async () => {
    const w = world(TEAMS, { askedToday: 59 });
    const sweep = await sweepSquads({ ...base, ...w, perDay: 60, budget: null, requestsToday: 0 });
    expect(w.dueLimits).toEqual([1]);
    expect(w.requests).toHaveLength(1);
    expect(sweep.asked).toBe(1);
  });

  it('asks nothing once the cap is spent, or the day’s budget is past its headroom', async () => {
    const spent = world(TEAMS, { askedToday: 60 });
    const capped = await sweepSquads({
      ...base,
      ...spent,
      perDay: 60,
      budget: null,
      requestsToday: 0,
    });
    expect(spent.requests).toEqual([]);
    expect(capped.idle).toMatch(/60 squad requests are spent/);

    const busy = world(TEAMS);
    const held = await sweepSquads({
      ...base,
      ...busy,
      perDay: 60,
      budget: 7000,
      requestsToday: 4900,
    });
    expect(busy.requests).toEqual([]);
    expect(held.idle).toMatch(/70% of the budget/);
  });

  it('stops at the first quota refusal and records the ask as unanswered', async () => {
    const w = world(TEAMS, { refuseAll: true });
    const sweep = await sweepSquads({ ...base, ...w, perDay: 60, budget: null, requestsToday: 0 });
    expect(w.requests).toHaveLength(1);
    expect(sweep.asked).toBe(1);
    expect(sweep.refused[0]).toMatch(/^team 10: quota/);
    expect(w.marked).toEqual([{ teamId: 'team-10', answered: false }]);
    expect(w.noted).toEqual([]);
  });

  it('says so, and asks nothing, when the provider does not list squads', async () => {
    const w = world(TEAMS);
    const { getSquad: _none, ...rest } = w.adapter;
    const adapter = { ...rest, manifest: w.adapter.manifest } as ProviderAdapter;
    const sweep = await sweepSquads({
      ...base,
      ...w,
      adapter,
      perDay: 60,
      budget: null,
      requestsToday: 0,
    });
    expect(sweep.idle).toBe('api_football does not list squads');
    expect(w.requests).toEqual([]);
  });
});

describe('INGESTION_SQUADS_PER_DAY', () => {
  it('takes a whole number up to the ceiling, 0 to turn it off, and the default otherwise', () => {
    expect(squadsPerDay(undefined)).toBe(60);
    expect(squadsPerDay('')).toBe(60);
    expect(squadsPerDay('0')).toBe(0);
    expect(squadsPerDay('120')).toBe(120);
    expect(squadsPerDay(String(MAX_SQUADS_PER_DAY + 1))).toBe(60);
    expect(squadsPerDay('1.5')).toBe(60);
    expect(squadsPerDay('-3')).toBe(60);
  });

  it('allows the cap less what was asked today, and nothing past the headroom', () => {
    expect(squadAllowance({ perDay: 60, askedToday: 10, budget: null, requestsToday: 0 })).toBe(50);
    expect(squadAllowance({ perDay: 60, askedToday: 70, budget: null, requestsToday: 0 })).toBe(0);
    expect(squadAllowance({ perDay: 60, askedToday: 0, budget: 7000, requestsToday: 4899 })).toBe(
      60,
    );
    expect(squadAllowance({ perDay: 60, askedToday: 0, budget: 7000, requestsToday: 4900 })).toBe(
      0,
    );
  });
});
