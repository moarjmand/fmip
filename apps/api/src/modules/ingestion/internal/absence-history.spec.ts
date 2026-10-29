import type {
  AdapterResult,
  NormalisedAbsence,
  ProviderAdapter,
  StandingsQuery,
} from '@fmip/ingestion';
import { describe, expect, it } from 'vitest';
import {
  absenceHistoryAllowance,
  absenceHistoryTotals,
  describeLine,
  sweepAbsenceHistory,
  type AbsenceHistoryFilter,
  type AbsenceHistoryStorePort,
  type AbsenceHistoryWrite,
  type AbsenceSeason,
} from './absence-history';
import { AskPacer } from './ask-pacer';

/**
 * T-1650 (D-306): the absence history asks each past season once, skips the
 * seasons the provider says it does not cover, stays inside the bulk tier,
 * and stops at a quota refusal. The store and the adapter are fakes.
 */
const season = (label: string, over: Partial<AbsenceSeason> = {}): AbsenceSeason => ({
  competitionId: 'c-39',
  competitionName: 'Premier League',
  competitionExternalId: '39',
  seasonId: `s-${label}`,
  seasonLabel: label,
  absencesCovered: true,
  ...over,
});

const absence = (fixture: string, player: string): NormalisedAbsence => ({
  fixtureExternalId: fixture,
  team: { externalId: '50', name: 'Club' },
  player: { externalId: player, name: 'A. Player' },
  status: 'out',
  kind: 'injury',
  reason: 'Knee Injury',
});

class FakeStore implements AbsenceHistoryStorePort {
  readonly writes: { count: number; fetchedAt: string }[] = [];
  readonly asked: { filter: AbsenceHistoryFilter; first: string }[] = [];
  relinks = 0;
  constructor(private readonly held: AbsenceSeason[]) {}
  seasons(_p: string, filter: AbsenceHistoryFilter, first: string): Promise<AbsenceSeason[]> {
    this.asked.push({ filter, first });
    return Promise.resolve(this.held);
  }
  write(
    _p: string,
    absences: NormalisedAbsence[],
    fetchedAt: string,
  ): Promise<AbsenceHistoryWrite> {
    this.writes.push({ count: absences.length, fetchedAt });
    return Promise.resolve({
      written: absences.length - 1,
      skipped: 1,
      fixturesUnmapped: 1,
      personsUnmapped: 2,
    });
  }
  relink(): Promise<number> {
    this.relinks += 1;
    return Promise.resolve(4);
  }
}

function adapter(
  answer: (q: StandingsQuery) => AdapterResult<NormalisedAbsence[]>,
  asked: string[],
): ProviderAdapter {
  return {
    getSeasonAbsences: (q: StandingsQuery) => {
      asked.push(`${q.competitionExternalId} ${q.seasonLabel}`);
      return Promise.resolve(answer(q));
    },
  } as unknown as ProviderAdapter;
}

const ok = (data: NormalisedAbsence[]): AdapterResult<NormalisedAbsence[]> => ({
  ok: true,
  data,
  requests: 1,
  fetchedAt: '2026-10-29T21:00:00.000Z',
});

const ALL: AbsenceHistoryFilter = { seasonLabel: null, competitionExternalId: null };
const noPause = new AskPacer(0);

describe('the absence history run', () => {
  it('asks each season once, writes the answers, and skips a season the provider does not cover', async () => {
    const store = new FakeStore([
      season('2021/22'),
      season('2022/23', { absencesCovered: false }),
      season('2023/24', { absencesCovered: null }),
      season('2024/25'),
    ]);
    const asked: string[] = [];
    const sweep = await sweepAbsenceHistory({
      provider: 'api_football',
      adapter: adapter(
        (q) =>
          q.seasonLabel === '2024/25'
            ? ok([])
            : ok([absence('1', '10'), absence('1', '11'), absence('2', '10')]),
        asked,
      ),
      store,
      filter: ALL,
      budget: null,
      bulkPercent: 70,
      requestsToday: 0,
      pacer: noPause,
    });
    expect(store.relinks).toBe(1);
    expect(store.asked).toEqual([{ filter: ALL, first: '2021-01-01' }]);
    // 2022/23 is never asked; an unknown answer (null) is asked.
    expect(asked).toEqual(['39 2021/22', '39 2023/24', '39 2024/25']);
    expect(sweep.lines.map((l) => [l.season, l.outcome, l.entries, l.written])).toEqual([
      ['2021/22', 'written', 3, 2],
      ['2022/23', 'not_covered', 0, 0],
      ['2023/24', 'written', 3, 2],
      ['2024/25', 'empty', 0, 0],
    ]);
    expect(store.writes).toEqual([
      { count: 3, fetchedAt: '2026-10-29T21:00:00.000Z' },
      { count: 3, fetchedAt: '2026-10-29T21:00:00.000Z' },
    ]);
    expect(sweep).toMatchObject({ asked: 3, relinked: 4 });
    expect(sweep.stopped).toBeUndefined();
    expect(absenceHistoryTotals(sweep.lines)).toEqual({
      seasons: 3,
      entries: 6,
      written: 4,
      skipped: 2,
      fixturesUnmapped: 2,
      personsUnmapped: 4,
    });
  });

  it('stays inside the bulk share of the day, and says which seasons it left', async () => {
    expect(absenceHistoryAllowance({ budget: 1000, bulkPercent: 70, requestsToday: 698 })).toBe(2);
    expect(absenceHistoryAllowance({ budget: 1000, bulkPercent: 70, requestsToday: 900 })).toBe(0);
    expect(absenceHistoryAllowance({ budget: null, bulkPercent: 70, requestsToday: 9 })).toBe(
      Number.POSITIVE_INFINITY,
    );
    const asked: string[] = [];
    const lines: string[] = [];
    const sweep = await sweepAbsenceHistory({
      provider: 'api_football',
      adapter: adapter(() => ok([absence('1', '10')]), asked),
      store: new FakeStore([season('2021/22'), season('2022/23'), season('2023/24')]),
      filter: ALL,
      budget: 1000,
      bulkPercent: 70,
      requestsToday: 698,
      pacer: noPause,
      onLine: (line) => lines.push(`${line.season} ${line.outcome}`),
    });
    expect(asked).toEqual(['39 2021/22', '39 2022/23']);
    expect(lines).toEqual(['2021/22 written', '2022/23 written', '2023/24 not_asked']);
    expect(sweep.stopped).toContain('70% of the budget');
  });

  it('moves on after a refusal, and stops at a quota one', async () => {
    const asked: string[] = [];
    const sweep = await sweepAbsenceHistory({
      provider: 'api_football',
      adapter: adapter((q) => {
        if (q.seasonLabel === '2021/22') {
          return { ok: false, error: { kind: 'unsupported', message: 'plan' }, requests: 1 };
        }
        return q.seasonLabel === '2022/23'
          ? { ok: false, error: { kind: 'quota', message: 'rateLimit' }, requests: 1 }
          : ok([absence('1', '10')]);
      }, asked),
      store: new FakeStore([season('2021/22'), season('2022/23'), season('2023/24')]),
      filter: ALL,
      budget: null,
      bulkPercent: 70,
      requestsToday: 0,
      pacer: noPause,
    });
    expect(asked).toEqual(['39 2021/22', '39 2022/23']);
    expect(sweep.lines.map((l) => [l.season, l.outcome])).toEqual([
      ['2021/22', 'refused'],
      ['2022/23', 'refused'],
      ['2023/24', 'not_asked'],
    ]);
    expect(sweep.stopped).toBe('stopped after a refusal (quota: rateLimit)');
    expect(describeLine(sweep.lines[0]!)).toBe(
      'Premier League (39) 2021/22: refused, unsupported: plan',
    );
  });

  it('asks nothing of a provider that lists no season of absences', async () => {
    const store = new FakeStore([season('2021/22')]);
    const sweep = await sweepAbsenceHistory({
      provider: 'football_data_org',
      adapter: {} as ProviderAdapter,
      store,
      filter: ALL,
      budget: null,
      bulkPercent: 70,
      requestsToday: 0,
      pacer: noPause,
    });
    expect(sweep).toEqual({
      lines: [],
      asked: 0,
      relinked: 0,
      stopped: "football_data_org lists no season's absences",
    });
    expect(store.relinks).toBe(0);
  });

  it('writes one summary line per season for the operator', () => {
    const base = {
      competition: 'La Liga',
      competitionExternalId: '140',
      season: '2023/24',
      entries: 0,
      written: 0,
      skipped: 0,
      fixturesUnmapped: 0,
      personsUnmapped: 0,
    };
    expect(
      describeLine({
        ...base,
        outcome: 'written',
        entries: 3000,
        written: 2990,
        skipped: 10,
        fixturesUnmapped: 3,
        personsUnmapped: 41,
      }),
    ).toBe(
      'La Liga (140) 2023/24: 3000 listed, 2990 written, 10 skipped (3 matches not held, or a club not held), 41 players kept by provider id',
    );
    expect(describeLine({ ...base, outcome: 'written', entries: 5, written: 5 })).toBe(
      'La Liga (140) 2023/24: 5 listed, 5 written',
    );
    expect(describeLine({ ...base, outcome: 'empty' })).toBe(
      'La Liga (140) 2023/24: the provider lists no absences',
    );
    expect(describeLine({ ...base, outcome: 'not_covered' })).toContain('reports no absences');
  });
});
