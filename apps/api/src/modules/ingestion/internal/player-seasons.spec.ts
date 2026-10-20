import type {
  AdapterResult,
  NormalisedCareerEntry,
  NormalisedPlayerSeasonLine,
  ProviderAdapter,
} from '@fmip/ingestion';
import { describe, expect, it } from 'vitest';
import {
  type CareerAsk,
  type PlayerSeasonsStore,
  type SeasonAsk,
  PLAYER_SEASONS_BATCH,
  playerSeasonsAllowance,
  playerSeasonsBatch,
  sweepPlayerSeasons,
} from './player-seasons';

/** The `player_seasons` sweep (T-1431, D-223) against a fake store and adapter. */

const NOW = new Date('2026-10-20T12:00:00Z');

function fakeStore(seasons: SeasonAsk[], careers: CareerAsk[]) {
  const calls: string[] = [];
  const store: PlayerSeasonsStore = {
    seasonsDue: async (_p, at, _max, limit) => {
      calls.push(`seasonsDue ${limit} ${at.playedBeforeIso} ${at.retryBeforeIso}`);
      return seasons.slice(0, limit);
    },
    careersDue: async (_p, at, _max, limit) => {
      calls.push(`careersDue ${limit} ${at.answeredBeforeIso}`);
      return careers.slice(0, limit);
    },
    markSeasonAsked: async (_p, ask) => {
      calls.push(`markSeason ${ask.externalId}`);
    },
    markCareerAsked: async (_p, ask) => {
      calls.push(`markCareer ${ask.externalId}`);
    },
    saveSeason: async (_p, ask, lines) => {
      calls.push(`saveSeason ${ask.externalId} ${ask.seasonYear} ${lines.length}`);
      return { kept: lines.length, unmapped: 1 };
    },
    saveCareer: async (_p, ask, entries) => {
      calls.push(`saveCareer ${ask.externalId} ${entries.length}`);
      return { kept: entries.length, unmapped: 0 };
    },
  };
  return { store, calls };
}

const LINE = { appearances: 1 } as NormalisedPlayerSeasonLine;
const ENTRY = { seasonYears: [2026] } as NormalisedCareerEntry;

function fakeAdapter(answer: (what: string) => AdapterResult<unknown>) {
  const asked: string[] = [];
  const adapter = {
    getPlayerSeason: async (person: string, season: string) => {
      asked.push(`season ${person} ${season}`);
      return answer(`season ${person}`) as AdapterResult<NormalisedPlayerSeasonLine[]>;
    },
    getPlayerCareer: async (person: string) => {
      asked.push(`career ${person}`);
      return answer(`career ${person}`) as AdapterResult<NormalisedCareerEntry[]>;
    },
  } as unknown as ProviderAdapter;
  return { adapter, asked };
}

const ok = (data: unknown): AdapterResult<unknown> => ({
  ok: true,
  data,
  requests: 1,
  fetchedAt: '2026-10-20T11:59:00Z',
});

const base = {
  provider: 'api_football' as const,
  now: NOW,
  batch: 10,
  budget: null,
  bulkPercent: 70,
  requestsToday: 0,
  wait: async () => {},
};

describe('the player seasons batch setting', () => {
  it('is 0 to 200, else the default', () => {
    expect(playerSeasonsBatch(undefined)).toBe(PLAYER_SEASONS_BATCH);
    expect(playerSeasonsBatch('')).toBe(PLAYER_SEASONS_BATCH);
    expect(playerSeasonsBatch('0')).toBe(0);
    expect(playerSeasonsBatch(' 150 ')).toBe(150);
    expect(playerSeasonsBatch('201')).toBe(PLAYER_SEASONS_BATCH);
    expect(playerSeasonsBatch('1.5')).toBe(PLAYER_SEASONS_BATCH);
    expect(playerSeasonsBatch('lots')).toBe(PLAYER_SEASONS_BATCH);
  });

  it('stays within the bulk share of the budget', () => {
    const seen = { batch: 100, budget: 75_000, bulkPercent: 70, requestsToday: 0 };
    expect(playerSeasonsAllowance(seen)).toBe(100);
    expect(playerSeasonsAllowance({ ...seen, requestsToday: 52_480 })).toBe(20);
    expect(playerSeasonsAllowance({ ...seen, requestsToday: 60_000 })).toBe(0);
    expect(playerSeasonsAllowance({ ...seen, budget: null, requestsToday: 1e9 })).toBe(100);
  });
});

describe('the player seasons sweep', () => {
  it('asks seasons first, then careers with what is left, and saves each answer', async () => {
    const { store, calls } = fakeStore(
      [
        { personId: 'p1', externalId: '1', seasonYear: 2026 },
        { personId: 'p2', externalId: '2', seasonYear: 2026 },
      ],
      [{ personId: 'p3', externalId: '3' }],
    );
    const { adapter, asked } = fakeAdapter((what) =>
      what.startsWith('season') ? ok([LINE, LINE]) : ok([ENTRY]),
    );
    const sweep = await sweepPlayerSeasons({ ...base, adapter, store, batch: 3 });
    expect(asked).toEqual(['season 1 2026', 'season 2 2026', 'career 3']);
    expect(sweep).toEqual({ asked: 3, answered: 3, written: 5, unmapped: 2, refused: [] });
    expect(calls).toEqual([
      'seasonsDue 3 2026-10-20T06:00:00.000Z 2026-10-19T12:00:00.000Z',
      'careersDue 1 2026-09-20T12:00:00.000Z',
      'saveSeason 1 2026 2',
      'saveSeason 2 2026 2',
      'saveCareer 3 1',
    ]);
  });

  it('does not ask for careers when the seasons fill the run', async () => {
    const { store, calls } = fakeStore(
      [{ personId: 'p1', externalId: '1', seasonYear: 2026 }],
      [{ personId: 'p3', externalId: '3' }],
    );
    const { adapter } = fakeAdapter(() => ok([]));
    await sweepPlayerSeasons({ ...base, adapter, store, batch: 1 });
    expect(calls.some((c) => c.startsWith('careersDue'))).toBe(false);
  });

  it('records a refusal against the player, and stops the run at a quota refusal', async () => {
    const { store, calls } = fakeStore(
      [
        { personId: 'p1', externalId: '1', seasonYear: 2026 },
        { personId: 'p2', externalId: '2', seasonYear: 2026 },
      ],
      [{ personId: 'p3', externalId: '3' }],
    );
    const { adapter, asked } = fakeAdapter((what) =>
      what === 'season 1'
        ? { ok: false, error: { kind: 'http', message: 'HTTP 500' }, requests: 1 }
        : { ok: false, error: { kind: 'quota', message: 'rateLimit' }, requests: 1 },
    );
    const sweep = await sweepPlayerSeasons({ ...base, adapter, store });
    expect(asked).toEqual(['season 1 2026', 'season 2 2026']);
    expect(sweep.refused).toEqual([
      'person 1 season 2026: http: HTTP 500',
      'person 2 season 2026: quota: rateLimit',
    ]);
    expect(calls.filter((c) => c.startsWith('mark'))).toEqual(['markSeason 1']);
  });

  it('stops asking once the run has taken its time', async () => {
    const { store } = fakeStore(
      [
        { personId: 'p1', externalId: '1', seasonYear: 2026 },
        { personId: 'p2', externalId: '2', seasonYear: 2026 },
      ],
      [],
    );
    const { adapter, asked } = fakeAdapter(() => ok([]));
    let t = 0;
    await sweepPlayerSeasons({
      ...base,
      adapter,
      store,
      runMs: 1000,
      clock: () => t,
      wait: async (ms) => {
        t += ms * 10;
      },
      gapMs: 250,
    });
    expect(asked).toEqual(['season 1 2026']);
  });

  it('is idle when off, over the bulk share, without the calls, or with nobody owed', async () => {
    const { store } = fakeStore([], []);
    const { adapter } = fakeAdapter(() => ok([]));
    expect((await sweepPlayerSeasons({ ...base, adapter, store, batch: 0 })).idle).toBe(
      'INGESTION_PLAYER_SEASONS_BATCH=0',
    );
    expect(
      (await sweepPlayerSeasons({ ...base, adapter, store, budget: 100, requestsToday: 70 })).idle,
    ).toBe("the day's requests are at 70% of the budget (bulk tier)");
    expect(
      (await sweepPlayerSeasons({ ...base, adapter: {} as ProviderAdapter, store })).idle,
    ).toBe('api_football has no player seasons');
    expect((await sweepPlayerSeasons({ ...base, adapter, store })).idle).toBe(
      'no player is owed a season or a career ask',
    );
  });
});
