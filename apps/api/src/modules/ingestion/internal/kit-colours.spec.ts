import type { AdapterResult, NormalisedLineup, ProviderAdapter } from '@fmip/ingestion';
import { describe, expect, it } from 'vitest';
import {
  KIT_COLOURS_BATCH,
  MAX_KIT_COLOURS_BATCH,
  type KitColoursStore,
  type MatchOwedShirts,
  kitColoursAllowance,
  kitColoursBatch,
  sweepKitColours,
} from './kit-colours';

/** The `kit_colours` job (T-1417, D-218), over a fake adapter and store. */

const lineup = (id: string, home: string | null, away: string | null): NormalisedLineup => ({
  fixtureExternalId: id,
  home: { formation: null, coach: null, players: [], kitColour: home },
  away: { formation: null, coach: null, players: [], kitColour: away },
});

function harness(
  due: MatchOwedShirts[],
  answer: (externalId: string) => AdapterResult<NormalisedLineup>,
) {
  const log = {
    asked: [] as string[],
    answered: [] as [string, number][],
    written: [] as string[],
  };
  const store: KitColoursStore = {
    matchesOwedShirts: (_p, _before, _max, limit) => Promise.resolve(due.slice(0, limit)),
    markShirtsAsked: (_p, fixtureId) => {
      log.asked.push(fixtureId);
      return Promise.resolve();
    },
    markShirtsAnswered: (_p, fixtureId, shirts) => {
      log.answered.push([fixtureId, shirts]);
      return Promise.resolve();
    },
  };
  const adapter = {
    getLineup: (externalId: string) => Promise.resolve(answer(externalId)),
  } as unknown as ProviderAdapter;
  const run = (over: Partial<Parameters<typeof sweepKitColours>[0]> = {}) =>
    sweepKitColours({
      provider: 'api_football',
      adapter,
      store,
      write: (fixtureId) => {
        log.written.push(fixtureId);
        return Promise.resolve();
      },
      now: new Date('2026-10-15T18:00:00Z'),
      batch: 10,
      budget: null,
      bulkPercent: 70,
      requestsToday: 0,
      wait: () => Promise.resolve(),
      ...over,
    });
  return { log, run };
}

const ok = (data: NormalisedLineup): AdapterResult<NormalisedLineup> => ({
  ok: true,
  data,
  requests: 1,
  fetchedAt: '2026-10-15T18:00:00Z',
});

describe('kitColoursBatch and kitColoursAllowance', () => {
  it('reads the setting, 0 turning the job off, and falls back on anything else', () => {
    expect(kitColoursBatch(undefined)).toBe(KIT_COLOURS_BATCH);
    expect(kitColoursBatch('0')).toBe(0);
    expect(kitColoursBatch('150')).toBe(150);
    expect(kitColoursBatch(String(MAX_KIT_COLOURS_BATCH + 1))).toBe(KIT_COLOURS_BATCH);
    expect(kitColoursBatch('ten')).toBe(KIT_COLOURS_BATCH);
  });

  it('stops at the bulk share of the day’s budget', () => {
    const at = (requestsToday: number) =>
      kitColoursAllowance({ batch: 100, budget: 75_000, bulkPercent: 70, requestsToday });
    expect(at(0)).toBe(100);
    expect(at(52_450)).toBe(50);
    expect(at(52_500)).toBe(0);
    expect(
      kitColoursAllowance({ batch: 100, budget: null, bulkPercent: 70, requestsToday: 9e9 }),
    ).toBe(100);
  });
});

describe('sweepKitColours', () => {
  it('writes each answer through the line-up writer and records how many sides had a shirt', async () => {
    const { log, run } = harness(
      [
        { fixtureId: 'f1', externalId: '1' },
        { fixtureId: 'f2', externalId: '2' },
      ],
      (id) => ok(id === '1' ? lineup(id, '#da291c', '#ffffff') : lineup(id, '#000000', null)),
    );
    const sweep = await run();
    expect(sweep).toMatchObject({ asked: 2, answered: 2, shirts: 3, refused: [] });
    expect(log.written).toEqual(['f1', 'f2']);
    expect(log.answered).toEqual([
      ['f1', 2],
      ['f2', 1],
    ]);
    expect(log.asked).toEqual([]);
  });

  it('records an unanswered ask, and stops the run at a quota refusal without costing an attempt', async () => {
    const { log, run } = harness(
      [
        { fixtureId: 'f1', externalId: '1' },
        { fixtureId: 'f2', externalId: '2' },
        { fixtureId: 'f3', externalId: '3' },
      ],
      (id) =>
        id === '1'
          ? { ok: false, error: { kind: 'unsupported', message: 'no lineup' }, requests: 1 }
          : { ok: false, error: { kind: 'quota', message: 'daily limit' }, requests: 1 },
    );
    const sweep = await run();
    expect(sweep.asked).toBe(2);
    expect(sweep.refused).toHaveLength(2);
    expect(log.asked).toEqual(['f1']);
    expect(log.written).toEqual([]);
  });

  it('asks nothing when turned off, at the bulk share, or with nothing owed', async () => {
    const { run } = harness([{ fixtureId: 'f1', externalId: '1' }], (id) =>
      ok(lineup(id, null, null)),
    );
    expect((await run({ batch: 0 })).idle).toContain('INGESTION_KIT_COLOURS_BATCH=0');
    expect((await run({ budget: 1000, requestsToday: 700 })).idle).toContain('bulk tier');
    const empty = harness([], (id) => ok(lineup(id, null, null)));
    expect((await empty.run()).idle).toContain('no finished match');
  });

  it('asks nothing new once the run has taken its time', async () => {
    let now = 0;
    const { log, run } = harness(
      [
        { fixtureId: 'f1', externalId: '1' },
        { fixtureId: 'f2', externalId: '2' },
      ],
      (id) => {
        now += 40_000;
        return ok(lineup(id, '#da291c', null));
      },
    );
    const sweep = await run({ clock: () => now, runMs: 30_000 });
    expect(sweep.asked).toBe(1);
    expect(log.written).toEqual(['f1']);
  });
});
