import type { AdapterResult, NormalisedTransfer, ProviderAdapter } from '@fmip/ingestion';
import { describe, expect, it } from 'vitest';
import { AskPacer } from './ask-pacer';
import {
  type TransferAsk,
  type TransfersStore,
  TRANSFERS_BATCH,
  sweepTransfers,
  transfersAllowance,
  transfersBatch,
} from './transfers';

/** The `transfers` sweep (T-1440, D-231) against a fake store and adapter. */

const OUT_OF_WINDOW = new Date('2026-10-21T12:00:00Z');
const IN_WINDOW = new Date('2026-07-21T12:00:00Z');

const team = (n: number): TransferAsk => ({ subject: 'team', id: `t${n}`, externalId: `${n}` });
const person = (n: number): TransferAsk => ({ subject: 'person', id: `p${n}`, externalId: `${n}` });

function fakeStore(teams: TransferAsk[], people: TransferAsk[]) {
  const calls: string[] = [];
  const store: TransfersStore = {
    due: async (_p, subject, at, _max, limit) => {
      calls.push(`due ${subject} ${limit} ${at.answeredBeforeIso} ${at.retryBeforeIso}`);
      return (subject === 'team' ? teams : people).slice(0, limit);
    },
    markAsked: async (_p, ask) => {
      calls.push(`mark ${ask.subject} ${ask.externalId}`);
    },
    save: async (_p, ask, moves) => {
      calls.push(`save ${ask.subject} ${ask.externalId} ${moves.length}`);
      return moves.length;
    },
  };
  return { store, calls };
}

const MOVE = { kind: 'loan' } as NormalisedTransfer;

function fakeAdapter(answer: (what: string) => AdapterResult<NormalisedTransfer[]>) {
  const asked: string[] = [];
  const adapter = {
    getTeamTransfers: async (id: string) => {
      asked.push(`team ${id}`);
      return answer(`team ${id}`);
    },
    getPlayerTransfers: async (id: string) => {
      asked.push(`person ${id}`);
      return answer(`person ${id}`);
    },
  } as unknown as ProviderAdapter;
  return { adapter, asked };
}

const ok = (data: NormalisedTransfer[]): AdapterResult<NormalisedTransfer[]> => ({
  ok: true,
  data,
  requests: 1,
  fetchedAt: '2026-10-21T11:59:00Z',
});

/** A pacer that never sleeps but records the waits it would have made. */
function fakePacer(clock: () => number) {
  const waits: number[] = [];
  const pacer = new AskPacer(500, clock, async (ms) => {
    waits.push(ms);
  });
  return { pacer, waits };
}

const base = {
  provider: 'api_football' as const,
  now: OUT_OF_WINDOW,
  batch: 10,
  budget: null,
  bulkPercent: 25,
  requestsToday: 0,
};

describe('transfersBatch', () => {
  it('reads the setting, 0 to 200, and falls back to the default', () => {
    expect(transfersBatch(undefined)).toBe(TRANSFERS_BATCH);
    expect(transfersBatch('')).toBe(TRANSFERS_BATCH);
    expect(transfersBatch('0')).toBe(0);
    expect(transfersBatch('150')).toBe(150);
    expect(transfersBatch('201')).toBe(TRANSFERS_BATCH);
    expect(transfersBatch('x')).toBe(TRANSFERS_BATCH);
  });
});

describe('transfersAllowance', () => {
  it('is the batch without a budget, and the bulk share left within one', () => {
    expect(transfersAllowance({ ...base, batch: 60 })).toBe(60);
    expect(
      transfersAllowance({ batch: 60, budget: 75_000, bulkPercent: 25, requestsToday: 18_720 }),
    ).toBe(30);
    expect(
      transfersAllowance({ batch: 60, budget: 75_000, bulkPercent: 25, requestsToday: 19_000 }),
    ).toBe(0);
  });
});

describe('sweepTransfers', () => {
  it('asks clubs first, then players with what is left, paced', async () => {
    const { store, calls } = fakeStore([team(50), team(33)], [person(1100), person(5)]);
    const { adapter, asked } = fakeAdapter(() => ok([MOVE, MOVE]));
    const now = 0;
    const clock = () => now;
    const { pacer, waits } = fakePacer(clock);
    const sweep = await sweepTransfers({ ...base, batch: 3, adapter, store, pacer, clock });
    expect(asked).toEqual(['team 50', 'team 33', 'person 1100']);
    expect(calls.filter((c) => c.startsWith('due')).map((c) => c.split(' ').slice(0, 3))).toEqual([
      ['due', 'team', '3'],
      ['due', 'person', '1'],
    ]);
    expect(sweep).toEqual({ asked: 3, answered: 3, written: 6, refused: [] });
    // Three asks on a clock that never moves: two waits of the whole gap.
    expect(waits).toEqual([500, 500]);
  });

  it('asks a month after the last answer outside a window, a week inside one', async () => {
    const outside = fakeStore([], []);
    await sweepTransfers({ ...base, ...fakeAdapter(() => ok([])), store: outside.store });
    expect(outside.calls[0]).toContain('2026-09-21T12:00:00.000Z');
    const inside = fakeStore([], []);
    await sweepTransfers({
      ...base,
      now: IN_WINDOW,
      ...fakeAdapter(() => ok([])),
      store: inside.store,
    });
    expect(inside.calls[0]).toContain('2026-07-14T12:00:00.000Z');
    // An unanswered ask is repeated after a day either way.
    expect(inside.calls[0]).toContain('2026-07-20T12:00:00.000Z');
  });

  it('records a refused ask and goes on, but stops at the quota', async () => {
    const { store, calls } = fakeStore([team(1), team(2), team(3)], []);
    const { adapter, asked } = fakeAdapter((what) =>
      what === 'team 1'
        ? { ok: false, error: { kind: 'transport', message: 'reset' }, requests: 1 }
        : what === 'team 2'
          ? { ok: false, error: { kind: 'quota', message: 'rateLimit' }, requests: 1 }
          : ok([MOVE]),
    );
    const { pacer } = fakePacer(() => 0);
    const sweep = await sweepTransfers({ ...base, adapter, store, pacer, clock: () => 0 });
    expect(asked).toEqual(['team 1', 'team 2']);
    expect(calls).toContain('mark team 1');
    expect(calls).not.toContain('mark team 2');
    expect(sweep.refused).toEqual(['team 1: transport: reset', 'team 2: quota: rateLimit']);
    expect(sweep.answered).toBe(0);
  });

  it('stops asking once the run has taken its time', async () => {
    const { store } = fakeStore([team(1), team(2), team(3)], []);
    const { adapter, asked } = fakeAdapter(() => ok([]));
    let now = 0;
    const clock = () => now;
    const pacer = new AskPacer(500, clock, async (ms) => {
      now += ms;
    });
    const tick = adapter.getTeamTransfers!.bind(adapter);
    adapter.getTeamTransfers = async (id: string) => {
      now += 20_000;
      return tick(id);
    };
    await sweepTransfers({ ...base, adapter, store, pacer, clock, runMs: 30_000 });
    expect(asked).toEqual(['team 1', 'team 2']);
  });

  it('is idle when turned off, out of budget, or owed nothing', async () => {
    const { store } = fakeStore([], []);
    const { adapter, asked } = fakeAdapter(() => ok([]));
    expect((await sweepTransfers({ ...base, batch: 0, adapter, store })).idle).toBe(
      'INGESTION_TRANSFERS_BATCH=0',
    );
    expect(
      (
        await sweepTransfers({
          ...base,
          budget: 1000,
          requestsToday: 250,
          adapter,
          store,
        })
      ).idle,
    ).toBe("the day's requests are at 25% of the budget (bulk tier)");
    expect((await sweepTransfers({ ...base, adapter, store })).idle).toBe(
      'no club or player is owed a transfers ask',
    );
    expect((await sweepTransfers({ ...base, adapter: {} as ProviderAdapter, store })).idle).toBe(
      'api_football has no transfers',
    );
    expect(asked).toEqual([]);
  });
});
