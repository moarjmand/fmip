import type { AdapterResult, NormalisedTransfer, ProviderAdapter } from '@fmip/ingestion';
import { describe, expect, it } from 'vitest';
import { AskPacer } from './ask-pacer';
import {
  type TransferAsk,
  type TransfersStore,
  TRANSFERS_BATCH,
  combineMoves,
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

describe('a player holding several provider ids (T-1866)', () => {
  const move = (date: string, from: string | null, to: string): NormalisedTransfer => ({
    player: { externalId: 'x', name: 'Player' },
    date,
    kind: 'free',
    fee: null,
    from: from === null ? null : { externalId: from, name: from },
    to: { externalId: to, name: to },
  });
  const both = (n: number, more: string[]): TransferAsk => ({
    ...person(n),
    moreExternalIds: more,
  });

  it('asks by each id and saves both answers once under the one person', async () => {
    const saved: { id: string; moves: NormalisedTransfer[] }[] = [];
    const { store, calls } = fakeStore([], [both(10, ['20'])]);
    store.save = async (_p, ask, moves) => {
      saved.push({ id: ask.id, moves });
      return moves.length;
    };
    const { adapter, asked } = fakeAdapter((what) =>
      what === 'person 10'
        ? ok([move('2019-07-01', 'a', 'b')])
        : ok([move('2024-01-10', 'b', 'c'), move('2019-07-01', 'a', 'b')]),
    );
    const { pacer, waits } = fakePacer(() => 0);
    const sweep = await sweepTransfers({ ...base, adapter, store, pacer });
    expect(asked).toEqual(['person 10', 'person 20']);
    expect(sweep).toEqual({ asked: 2, answered: 1, written: 2, refused: [] });
    expect(saved).toEqual([
      { id: 'p10', moves: [move('2019-07-01', 'a', 'b'), move('2024-01-10', 'b', 'c')] },
    ]);
    // The second id is paced like any other ask (the first ask of a run waits for none).
    expect(waits).toEqual([500]);
    expect(calls.filter((c) => c.startsWith('due'))).toEqual([
      'due team 10 2026-09-21T12:00:00.000Z 2026-10-20T12:00:00.000Z',
      'due person 10 2026-09-21T12:00:00.000Z 2026-10-20T12:00:00.000Z',
    ]);
  });

  it('counts each id against the batch, and leaves a player whose ids do not fit', async () => {
    const { store } = fakeStore([team(1)], [both(10, ['20']), person(30)]);
    const { adapter, asked } = fakeAdapter(() => ok([]));
    const { pacer } = fakePacer(() => 0);
    const sweep = await sweepTransfers({ ...base, adapter, store, pacer, batch: 2 });
    // The club takes one of two; the player's two ids do not fit in the one left.
    expect(asked).toEqual(['team 1']);
    expect(sweep.asked).toBe(1);
  });

  it('stays within the bulk share of the budget with every id counted', async () => {
    const { store } = fakeStore([], [both(10, ['20']), person(30)]);
    const { adapter, asked } = fakeAdapter(() => ok([]));
    const { pacer } = fakePacer(() => 0);
    // 25% of 100 is 25; 22 are spent, so three asks are left.
    const sweep = await sweepTransfers({
      ...base,
      adapter,
      store,
      pacer,
      budget: 100,
      requestsToday: 22,
    });
    expect(asked).toEqual(['person 10', 'person 20', 'person 30']);
    expect(sweep.asked).toBe(3);
  });

  it('saves nothing when one id is refused, and stops at a quota refusal', async () => {
    const { store, calls } = fakeStore([], [both(10, ['20']), both(30, ['40'])]);
    const { adapter, asked } = fakeAdapter((what) =>
      what === 'person 20'
        ? { ok: false, error: { kind: 'http', message: 'HTTP 500' }, requests: 1 }
        : what === 'person 40'
          ? { ok: false, error: { kind: 'quota', message: 'rateLimit' }, requests: 1 }
          : ok([move('2019-07-01', 'a', 'b')]),
    );
    const { pacer } = fakePacer(() => 0);
    const sweep = await sweepTransfers({ ...base, adapter, store, pacer });
    expect(asked).toEqual(['person 10', 'person 20', 'person 30', 'person 40']);
    expect(sweep.refused).toEqual(['person 20: http: HTTP 500', 'person 40: quota: rateLimit']);
    expect(calls.filter((c) => c.startsWith('save'))).toEqual([]);
    expect(calls.filter((c) => c.startsWith('mark'))).toEqual(['mark person 10']);
  });

  it('reads the run clock before the second id: out of time, nothing saved or marked (T-1868)', async () => {
    const { store, calls } = fakeStore([], [both(10, ['20']), person(30)]);
    const { adapter, asked } = fakeAdapter(() => ok([move('2019-07-01', 'a', 'b')]));
    let now = 0;
    const clock = () => now;
    const pacer = new AskPacer(500, clock, async (ms) => {
      now += ms;
    });
    const tick = adapter.getPlayerTransfers!.bind(adapter);
    adapter.getPlayerTransfers = async (id: string) => {
      now += 20_000;
      return tick(id);
    };
    const sweep = await sweepTransfers({ ...base, adapter, store, pacer, clock, runMs: 15_000 });
    expect(asked).toEqual(['person 10']);
    expect(sweep).toEqual({ asked: 1, answered: 0, written: 0, refused: [] });
    expect(calls.filter((c) => c.startsWith('save') || c.startsWith('mark'))).toEqual([]);
  });

  it('combines one answer as it is', () => {
    const one = [move('2019-07-01', 'a', 'b'), move('2019-07-01', 'a', 'b')];
    expect(combineMoves([one])).toBe(one);
    expect(
      combineMoves([[move('2019-07-01', null, 'b')], [move('2019-07-01', null, 'b')]]),
    ).toEqual([move('2019-07-01', null, 'b')]);
  });
});
