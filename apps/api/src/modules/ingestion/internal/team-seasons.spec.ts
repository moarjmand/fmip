import type { AdapterResult, NormalisedTeamSeasonStats, ProviderAdapter } from '@fmip/ingestion';
import { describe, expect, it } from 'vitest';
import {
  TEAM_SEASONS_BATCH,
  type TeamSeasonAsk,
  type TeamSeasonsStore,
  sweepTeamSeasons,
  teamSeasonsBatch,
} from './team-seasons';

/** The `team_seasons` sweep (T-1437, D-228) against a fake store and adapter. */

const NOW = new Date('2026-10-21T12:00:00Z');
const STATS = { played: { home: 1, away: 0 } } as NormalisedTeamSeasonStats;

const ask = (n: number): TeamSeasonAsk => ({
  teamId: `team-${n}`,
  seasonId: `season-${n}`,
  teamExternalId: String(n),
  competitionExternalId: '39',
  seasonLabel: '2026/27',
});

function fakeStore(due: TeamSeasonAsk[]) {
  const calls: string[] = [];
  const store: TeamSeasonsStore = {
    due: async (_p, at, max, limit) => {
      calls.push(
        `due ${limit} ${max} ${at.settledBeforeIso} ${at.refreshBeforeIso} ${at.retryBeforeIso}`,
      );
      return due.slice(0, limit);
    },
    markAsked: async (_p, a) => {
      calls.push(`mark ${a.teamExternalId}`);
    },
    save: async (_p, a, stats, fetchedAt) => {
      calls.push(`save ${a.teamExternalId} ${stats === null ? 'none' : 'stats'} ${fetchedAt}`);
    },
  };
  return { store, calls };
}

function fakeAdapter(answer: (team: string) => AdapterResult<NormalisedTeamSeasonStats | null>) {
  const asked: string[] = [];
  const adapter = {
    getTeamSeasonStats: async (league: string, season: string, team: string) => {
      asked.push(`${league} ${season} ${team}`);
      return answer(team);
    },
  } as unknown as ProviderAdapter;
  return { adapter, asked };
}

const ok = (
  data: NormalisedTeamSeasonStats | null,
): AdapterResult<NormalisedTeamSeasonStats | null> => ({
  ok: true,
  data,
  requests: 1,
  fetchedAt: '2026-10-21T12:00:01Z',
});
const noPace = { pace: () => Promise.resolve() };
const base = {
  provider: 'api_football' as const,
  now: NOW,
  budget: null,
  bulkPercent: 80,
  requestsToday: 0,
  pacer: noPace,
};

describe('teamSeasonsBatch', () => {
  it('reads the setting, 0 to 200, else the default', () => {
    expect(teamSeasonsBatch(undefined)).toBe(TEAM_SEASONS_BATCH);
    expect(teamSeasonsBatch('0')).toBe(0);
    expect(teamSeasonsBatch(' 150 ')).toBe(150);
    expect(teamSeasonsBatch('201')).toBe(TEAM_SEASONS_BATCH);
    expect(teamSeasonsBatch('ten')).toBe(TEAM_SEASONS_BATCH);
  });
});

describe('sweepTeamSeasons (T-1437)', () => {
  it('asks each due team by league, season and team, and saves statistics and their absence', async () => {
    const { store, calls } = fakeStore([ask(1), ask(2)]);
    const { adapter, asked } = fakeAdapter((team) => ok(team === '1' ? STATS : null));
    const sweep = await sweepTeamSeasons({ ...base, adapter, store, batch: 10 });
    expect(asked).toEqual(['39 2026/27 1', '39 2026/27 2']);
    expect(sweep).toEqual({ asked: 2, answered: 2, written: 1, empty: 1, refused: [] });
    expect(calls).toEqual([
      // Settled six hours ago, refreshed after seven days, retried after a day.
      'due 10 5 2026-10-21T06:00:00.000Z 2026-10-14T12:00:00.000Z 2026-10-20T12:00:00.000Z',
      'save 1 stats 2026-10-21T12:00:01Z',
      'save 2 none 2026-10-21T12:00:01Z',
    ]);
  });

  it('records a refused ask, and stops the run at a quota refusal', async () => {
    const { store, calls } = fakeStore([ask(1), ask(2), ask(3)]);
    const { adapter, asked } = fakeAdapter((team) =>
      team === '1'
        ? { ok: false, error: { kind: 'http', message: 'HTTP 500' }, requests: 1 }
        : { ok: false, error: { kind: 'quota', message: 'requests: limit' }, requests: 1 },
    );
    const sweep = await sweepTeamSeasons({ ...base, adapter, store, batch: 10 });
    expect(asked).toHaveLength(2);
    expect(sweep.asked).toBe(2);
    expect(sweep.refused).toHaveLength(2);
    expect(calls.filter((c) => c.startsWith('mark'))).toEqual(['mark 1']);
  });

  it('stays idle with the job off, without the call, or at the bulk share', async () => {
    const { store } = fakeStore([ask(1)]);
    const { adapter, asked } = fakeAdapter(() => ok(STATS));
    expect((await sweepTeamSeasons({ ...base, adapter, store, batch: 0 })).idle).toBe(
      'INGESTION_TEAM_SEASONS_BATCH=0',
    );
    expect(
      (await sweepTeamSeasons({ ...base, adapter: {} as ProviderAdapter, store, batch: 10 })).idle,
    ).toBe('api_football has no team statistics');
    const full = await sweepTeamSeasons({
      ...base,
      adapter,
      store,
      batch: 10,
      budget: 75_000,
      requestsToday: 60_000,
    });
    expect(full.idle).toMatch(/bulk tier/);
    expect(asked).toEqual([]);
  });

  it('asks no more than the bulk share leaves, and nothing past the run time', async () => {
    const { store, calls } = fakeStore([ask(1), ask(2), ask(3)]);
    const { adapter, asked } = fakeAdapter(() => ok(STATS));
    await sweepTeamSeasons({
      ...base,
      adapter,
      store,
      batch: 10,
      budget: 100,
      bulkPercent: 80,
      requestsToday: 78,
    });
    expect(calls[0]).toMatch(/^due 2 /);
    expect(asked).toHaveLength(2);

    let t = 0;
    const timed = fakeAdapter(() => {
      t += 20_000;
      return ok(STATS);
    });
    const sweep = await sweepTeamSeasons({
      ...base,
      adapter: timed.adapter,
      store: fakeStore([ask(1), ask(2), ask(3)]).store,
      batch: 10,
      clock: () => t,
      runMs: 30_000,
    });
    expect(timed.asked).toHaveLength(2);
    expect(sweep.answered).toBe(2);
  });

  it('paces every ask', async () => {
    const { store } = fakeStore([ask(1), ask(2)]);
    const { adapter } = fakeAdapter(() => ok(STATS));
    let paced = 0;
    await sweepTeamSeasons({
      ...base,
      adapter,
      store,
      batch: 10,
      pacer: { pace: async () => void (paced += 1) },
    });
    expect(paced).toBe(2);
  });

  it('says so when no team is owed an ask', async () => {
    const { store } = fakeStore([]);
    const { adapter } = fakeAdapter(() => ok(STATS));
    expect((await sweepTeamSeasons({ ...base, adapter, store, batch: 10 })).idle).toBe(
      'no team is owed a season ask',
    );
  });
});
