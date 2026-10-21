import type {
  AdapterResult,
  NormalisedTeamFacts,
  NormalisedVenueFacts,
  ProviderAdapter,
  StandingsQuery,
} from '@fmip/ingestion';
import { describe, expect, it } from 'vitest';
import {
  CLUB_FACTS_BATCH,
  type ClubFactsSource,
  type SeasonTeamsAsk,
  type VenueAsk,
  clubFactsAllowance,
  clubFactsBatch,
  sweepClubFacts,
} from './club-facts';

/** The club-and-ground pass (T-1438, D-229) against a fake store and adapter. */

const NOW = new Date('2026-10-21T03:41:00Z');

const season = (n: number): SeasonTeamsAsk => ({
  seasonId: `season-${n}`,
  competitionExternalId: '39',
  seasonLabel: `${2020 + n}/${21 + n}`,
});
const venue = (n: number): VenueAsk => ({ venueId: `venue-${n}`, externalId: String(n) });

const ground: NormalisedVenueFacts = {
  externalId: '556',
  name: 'Old Trafford',
  city: 'Manchester',
  address: 'Sir Matt Busby Way',
  capacity: 76212,
  surface: 'grass',
  imageUrl: 'https://media.api-sports.io/football/venues/556.png',
};

function fakeStore(due: { seasons: SeasonTeamsAsk[]; venues: VenueAsk[] }) {
  const log: string[] = [];
  const store: ClubFactsSource = {
    seasonsDue: async (_p, _at, _max, limit) => due.seasons.slice(0, limit),
    venuesDue: async (_p, _at, _max, limit) => due.venues.slice(0, limit),
    markSeasonFailed: async (_p, id) => void log.push(`season failed ${id}`),
    markVenueFailed: async (_p, id) => void log.push(`venue failed ${id}`),
    saveSeasonTeams: async (_p, id, teams) => {
      log.push(`season saved ${id} (${teams.length})`);
      return {
        held: teams.length,
        clubsWritten: 1,
        venuesWritten: 1,
        unmappedVenues: 0,
        images: [{ entityType: 'venue', entityId: 'venue-556', url: ground.imageUrl! }],
      };
    },
    saveVenue: async (_p, id, v) => {
      log.push(`venue saved ${id} ${v === null ? 'none' : v.name}`);
      return v !== null;
    },
  };
  return { store, log };
}

function fakeAdapter(answers: {
  teams?: (q: StandingsQuery) => AdapterResult<NormalisedTeamFacts[]>;
  venue?: (id: string) => AdapterResult<NormalisedVenueFacts | null>;
}): { adapter: ProviderAdapter; asked: string[] } {
  const asked: string[] = [];
  const adapter = {
    getSeasonTeams: async (q: StandingsQuery) => {
      asked.push(`teams ${q.competitionExternalId}/${q.seasonLabel}`);
      return (
        answers.teams?.(q) ?? { ok: true, data: [], requests: 1, fetchedAt: NOW.toISOString() }
      );
    },
    getVenue: async (id: string) => {
      asked.push(`venue ${id}`);
      return answers.venue?.(id) ?? { ok: true, data: ground, requests: 1, fetchedAt: '' };
    },
  } as unknown as ProviderAdapter;
  return { adapter, asked };
}

const media = () => {
  const noted: string[] = [];
  return {
    noted,
    sink: { note: async (_p: string, t: string, id: string) => void noted.push(`${t} ${id}`) },
  };
};

const base = {
  provider: 'api_football' as const,
  now: NOW,
  budget: null,
  bulkPercent: 70,
  requestsToday: 0,
};
const noPause = { pace: async () => {} };

describe('the club-and-ground pass (T-1438)', () => {
  it('asks seasons first, then grounds, and hands the pictures to the media store', async () => {
    const { store, log } = fakeStore({ seasons: [season(1)], venues: [venue(7)] });
    const { adapter, asked } = fakeAdapter({
      teams: () => ({
        ok: true,
        data: [
          {
            team: { externalId: '33', name: 'Manchester United' },
            national: false,
            foundedYear: 1878,
            venue: ground,
          },
        ],
        requests: 1,
        fetchedAt: '',
      }),
    });
    const m = media();
    const sweep = await sweepClubFacts({
      ...base,
      adapter,
      store,
      media: m.sink,
      batch: 10,
      pacer: noPause,
    });
    expect(asked).toEqual(['teams 39/2021/22', 'venue 7']);
    expect(log).toEqual(['season saved season-1 (1)', 'venue saved venue-7 Old Trafford']);
    expect(m.noted).toEqual(['venue venue-556', 'venue venue-7']);
    expect(sweep).toEqual({
      asked: 2,
      answered: 2,
      teamsSeen: 1,
      clubsWritten: 1,
      venuesWritten: 2,
      unmappedVenues: 0,
      refused: [],
    });
  });

  it('stops at the batch, and grounds get only what the seasons left', async () => {
    const { store } = fakeStore({
      seasons: [season(1), season(2)],
      venues: [venue(1), venue(2)],
    });
    const { adapter, asked } = fakeAdapter({});
    await sweepClubFacts({
      ...base,
      adapter,
      store,
      media: media().sink,
      batch: 3,
      pacer: noPause,
    });
    expect(asked).toEqual(['teams 39/2021/22', 'teams 39/2022/23', 'venue 1']);
  });

  it('stops at the run time', async () => {
    let t = 0;
    const { store } = fakeStore({ seasons: [season(1), season(2), season(3)], venues: [venue(1)] });
    const { adapter, asked } = fakeAdapter({});
    await sweepClubFacts({
      ...base,
      adapter,
      store,
      media: media().sink,
      batch: 10,
      clock: () => t,
      runMs: 1000,
      pacer: { pace: async () => void (t += 600) },
    });
    expect(asked).toEqual(['teams 39/2021/22', 'teams 39/2022/23']);
  });

  it('records a refused ask and moves on, and stops at a quota refusal', async () => {
    const { store, log } = fakeStore({ seasons: [season(1), season(2)], venues: [venue(1)] });
    let n = 0;
    const { adapter, asked } = fakeAdapter({
      teams: () =>
        n++ === 0
          ? { ok: false, error: { kind: 'http', message: 'HTTP 500' }, requests: 1 }
          : { ok: false, error: { kind: 'quota', message: 'rateLimit' }, requests: 1 },
    });
    const sweep = await sweepClubFacts({
      ...base,
      adapter,
      store,
      media: media().sink,
      batch: 10,
      pacer: noPause,
    });
    expect(asked).toEqual(['teams 39/2021/22', 'teams 39/2022/23']);
    expect(log).toEqual(['season failed season-1']);
    expect(sweep.refused).toEqual([
      'season 39/2021/22: http: HTTP 500',
      'season 39/2022/23: quota: rateLimit',
    ]);
  });

  it('records a ground the provider has no entry for', async () => {
    const { store, log } = fakeStore({ seasons: [], venues: [venue(9)] });
    const { adapter } = fakeAdapter({
      venue: () => ({ ok: true, data: null, requests: 1, fetchedAt: '' }),
    });
    const m = media();
    const sweep = await sweepClubFacts({
      ...base,
      adapter,
      store,
      media: m.sink,
      batch: 5,
      pacer: noPause,
    });
    expect(log).toEqual(['venue saved venue-9 none']);
    expect(m.noted).toEqual([]);
    expect(sweep.venuesWritten).toBe(0);
  });

  it('is idle, and says why, when there is nothing to ask or no room to ask it', async () => {
    const { adapter, asked } = fakeAdapter({});
    const empty = fakeStore({ seasons: [], venues: [] }).store;
    const run = (over: object) =>
      sweepClubFacts({
        ...base,
        adapter,
        store: empty,
        media: media().sink,
        batch: 5,
        pacer: noPause,
        ...over,
      });
    expect((await run({})).idle).toBe('every season and ground is current');
    expect((await run({ batch: 0 })).idle).toBe('INGESTION_CLUB_FACTS_BATCH=0');
    expect((await run({ budget: 1000, requestsToday: 700 })).idle).toMatch(/bulk tier/);
    expect((await run({ adapter: {} as ProviderAdapter })).idle).toBe(
      'api_football lists no club or ground facts',
    );
    expect(asked).toEqual([]);
  });

  it('reads its batch setting and its allowance', () => {
    expect(clubFactsBatch(undefined)).toBe(CLUB_FACTS_BATCH);
    expect(clubFactsBatch('0')).toBe(0);
    expect(clubFactsBatch('250')).toBe(250);
    expect(clubFactsBatch('301')).toBe(CLUB_FACTS_BATCH);
    expect(clubFactsBatch('lots')).toBe(CLUB_FACTS_BATCH);
    expect(
      clubFactsAllowance({ batch: 100, budget: null, bulkPercent: 70, requestsToday: 9e9 }),
    ).toBe(100);
    expect(
      clubFactsAllowance({ batch: 100, budget: 1000, bulkPercent: 70, requestsToday: 650 }),
    ).toBe(50);
    expect(
      clubFactsAllowance({ batch: 100, budget: 1000, bulkPercent: 70, requestsToday: 800 }),
    ).toBe(0);
  });
});
