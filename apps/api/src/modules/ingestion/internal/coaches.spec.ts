import { describe, expect, it } from 'vitest';
import type { AdapterResult, NormalisedCoach, ProviderAdapter } from '@fmip/ingestion';
import {
  COACHES_BATCH,
  COACHES_MAX_FAILURES,
  type CoachesKept,
  type CoachesStore,
  type TeamAsk,
  coachesAllowance,
  coachesBatch,
  sweepCoaches,
} from './coaches';

const NOW = new Date('2026-10-21T12:00:00Z');

function ask(externalId: string, reason: TeamAsk['reason'] = 'never_asked'): TeamAsk {
  return { teamId: `team-${externalId}`, externalId, reason };
}

const MARESCA: NormalisedCoach = {
  ref: { externalId: 'coach:12629', name: 'E. Maresca' },
  name: { fullName: 'Vincenzo Maresca', givenName: 'Vincenzo', familyName: 'Maresca' },
  dateOfBirth: '1980-02-10',
  nationality: { name: 'Italy', code: null },
  career: [{ team: { externalId: '50', name: 'Manchester City' }, start: '2026-08-01', end: null }],
};

class FakeStore implements CoachesStore {
  readonly asked: string[] = [];
  readonly saved: { team: string; coaches: number }[] = [];
  seenLimit: number | null = null;
  seenAt: { answeredBeforeIso: string; retryBeforeIso: string } | null = null;
  constructor(
    private readonly due: TeamAsk[],
    private readonly restored = 0,
  ) {}
  restoreSplitReferences(): Promise<number> {
    return Promise.resolve(this.restored);
  }
  teamsDue(
    _provider: string,
    at: { answeredBeforeIso: string; retryBeforeIso: string },
    maxFailures: number,
    limit: number,
  ): Promise<TeamAsk[]> {
    expect(maxFailures).toBe(COACHES_MAX_FAILURES);
    this.seenLimit = limit;
    this.seenAt = at;
    return Promise.resolve(this.due.slice(0, limit));
  }
  markTeamAsked(_provider: string, a: TeamAsk): Promise<void> {
    this.asked.push(a.externalId);
    return Promise.resolve();
  }
  saveTeamCoaches(_p: string, a: TeamAsk, coaches: NormalisedCoach[]): Promise<CoachesKept> {
    this.saved.push({ team: a.externalId, coaches: coaches.length });
    return Promise.resolve({ coaches: coaches.length, queued: 1, spells: 2, spellsUnmapped: 0 });
  }
}

function adapterAnswering(
  answer: (team: string) => AdapterResult<NormalisedCoach[]>,
  asked: string[] = [],
): ProviderAdapter {
  return {
    getTeamCoaches: (team: string) => {
      asked.push(team);
      return Promise.resolve(answer(team));
    },
  } as unknown as ProviderAdapter;
}

const ok = (data: NormalisedCoach[]): AdapterResult<NormalisedCoach[]> => ({
  ok: true,
  data,
  requests: 1,
  fetchedAt: NOW.toISOString(),
});

const NO_PACING = { pace: () => Promise.resolve() };

function sweep(
  store: CoachesStore,
  adapter: ProviderAdapter,
  extra: Partial<Parameters<typeof sweepCoaches>[0]> = {},
) {
  return sweepCoaches({
    provider: 'api_football',
    adapter,
    store,
    now: NOW,
    batch: 10,
    budget: 75_000,
    bulkPercent: 50,
    requestsToday: 0,
    pacer: NO_PACING,
    ...extra,
  });
}

describe('the setting', () => {
  it('reads 0 as off, a whole number to the ceiling, anything else as the default', () => {
    expect(coachesBatch(undefined)).toBe(COACHES_BATCH);
    expect(coachesBatch('')).toBe(COACHES_BATCH);
    expect(coachesBatch('0')).toBe(0);
    expect(coachesBatch('120')).toBe(120);
    expect(coachesBatch('201')).toBe(COACHES_BATCH);
    expect(coachesBatch('2.5')).toBe(COACHES_BATCH);
    expect(coachesBatch('ten')).toBe(COACHES_BATCH);
  });

  it('stops at the bulk share of the budget', () => {
    const seen = { batch: 60, budget: 75_000, bulkPercent: 50 };
    expect(coachesAllowance({ ...seen, requestsToday: 0 })).toBe(60);
    expect(coachesAllowance({ ...seen, requestsToday: 37_480 })).toBe(20);
    expect(coachesAllowance({ ...seen, requestsToday: 40_000 })).toBe(0);
    expect(coachesAllowance({ ...seen, budget: null, requestsToday: 99_999 })).toBe(60);
  });
});

describe('a coaches run', () => {
  it('asks each team owed an ask once, paced, and writes the answers', async () => {
    const store = new FakeStore([ask('50', 'lineup_change'), ask('49')], 3);
    const asked: string[] = [];
    let paced = 0;
    const result = await sweep(
      store,
      adapterAnswering(() => ok([MARESCA]), asked),
      {
        pacer: { pace: () => Promise.resolve(void (paced += 1)) },
      },
    );
    expect(asked).toEqual(['50', '49']);
    expect(paced).toBe(2);
    expect(store.saved).toEqual([
      { team: '50', coaches: 1 },
      { team: '49', coaches: 1 },
    ]);
    expect(result).toMatchObject({
      asked: 2,
      answered: 2,
      coaches: 2,
      spells: 4,
      queued: 2,
      restored: 3,
      written: 3 + 2 + 4,
      refused: [],
    });
    expect(store.seenAt).toEqual({
      answeredBeforeIso: '2026-09-21T12:00:00.000Z',
      retryBeforeIso: '2026-10-20T12:00:00.000Z',
    });
  });

  it('records a refusal against the team and goes on, but stops at a quota', async () => {
    const store = new FakeStore([ask('1'), ask('2'), ask('3')]);
    const asked: string[] = [];
    const result = await sweep(
      store,
      adapterAnswering((team) => {
        if (team === '1') {
          return { ok: false, error: { kind: 'http', message: 'status 500' }, requests: 1 };
        }
        return { ok: false, error: { kind: 'quota', message: 'daily limit' }, requests: 1 };
      }, asked),
    );
    expect(asked).toEqual(['1', '2']);
    expect(store.asked).toEqual(['1']);
    expect(result.refused).toEqual([
      'team 1 coaches: http: status 500',
      'team 2 coaches: quota: daily limit',
    ]);
    expect(result.answered).toBe(0);
  });

  it('asks no more than the budget leaves, and nothing past the run time', async () => {
    const store = new FakeStore([ask('1'), ask('2'), ask('3')]);
    await sweep(
      store,
      adapterAnswering(() => ok([])),
      { requestsToday: 37_499 },
    );
    expect(store.seenLimit).toBe(1);

    let now = 0;
    const timed = new FakeStore([ask('1'), ask('2'), ask('3')]);
    const asked: string[] = [];
    await sweep(
      timed,
      adapterAnswering(() => {
        now += 20_000;
        return ok([]);
      }, asked),
      { clock: () => now, runMs: 30_000 },
    );
    expect(asked).toEqual(['1', '2']);
  });

  it('puts references back even when it asks nothing', async () => {
    const off = await sweep(
      new FakeStore([ask('1')], 4),
      adapterAnswering(() => ok([])),
      {
        batch: 0,
      },
    );
    expect(off).toMatchObject({
      asked: 0,
      restored: 4,
      written: 4,
      idle: 'INGESTION_COACHES_BATCH=0',
    });

    const spent = await sweep(
      new FakeStore([ask('1')]),
      adapterAnswering(() => ok([])),
      {
        requestsToday: 40_000,
      },
    );
    expect(spent.idle).toMatch(/bulk tier/);

    const none = await sweep(
      new FakeStore([]),
      adapterAnswering(() => ok([])),
    );
    expect(none.idle).toBe('no team is owed a coaches ask');

    const unable = await sweep(new FakeStore([ask('1')], 1), {} as ProviderAdapter);
    expect(unable).toMatchObject({ restored: 1, idle: 'api_football has no coaches' });
  });
});
