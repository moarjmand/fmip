import { describe, expect, it } from 'vitest';
import type { ProviderAdapter, Transport, TransportResponse } from '@fmip/ingestion';
import { IngestRunsService, withBudgetNote } from '../ingest-runs.service';
import type { PostgresRunStore } from './run-store';
import {
  DEFAULT_TIER_SHARES,
  currentBudgetTier,
  parseTierShares,
  tierCeiling,
  tierOfRun,
  withBudgetTier,
  type BudgetTier,
} from './budget-tier';
import { withRequestTally, type RequestTally } from './request-meter';
import { BudgetedTransport, resolveSources } from './sources';

function counting(): { transport: Transport; calls: () => number } {
  let calls = 0;
  return {
    transport: {
      async request(): Promise<TransportResponse> {
        calls += 1;
        return { status: 200, body: {}, receivedAt: new Date().toISOString() };
      },
    },
    calls: () => calls,
  };
}

/** Sends one request as `tier` and answers its status. */
function send(transport: Transport, tier: BudgetTier): Promise<number> {
  return withBudgetTier(tier, async () => (await transport.request('https://x.test')).status);
}

describe('which tier a run draws on (T-1365, D-183)', () => {
  it('keeps live, line-ups and just-finished detail critical', () => {
    expect(tierOfRun('live', null)).toBe('critical');
    expect(tierOfRun('lineups', null)).toBe('critical');
    expect(tierOfRun('post_match', null)).toBe('critical');
  });

  it('makes the fixture list and the standings check standard, a schedule sweep included', () => {
    expect(tierOfRun('fixtures', null)).toBe('standard');
    expect(tierOfRun('fixtures', 'schedule')).toBe('standard');
    expect(tierOfRun('standings', null)).toBe('standard');
  });

  it('makes backfills, the squads sweep and anything unknown bulk', () => {
    expect(tierOfRun('fixtures', 'backfill')).toBe('bulk');
    expect(tierOfRun('fixtures', 'backfill 2023/24')).toBe('bulk');
    expect(tierOfRun('squads', null)).toBe('bulk');
    expect(tierOfRun('something_new', null)).toBe('bulk');
  });

  it('treats a request sent outside any tier as bulk, and an inner tier wins', async () => {
    expect(currentBudgetTier()).toBe('bulk');
    await withBudgetTier('critical', async () => {
      expect(currentBudgetTier()).toBe('critical');
      await withBudgetTier('bulk', async () => expect(currentBudgetTier()).toBe('bulk'));
      expect(currentBudgetTier()).toBe('critical');
    });
  });
});

describe('the shares', () => {
  it('defaults to bulk 70 % and standard 90 %', () => {
    expect(DEFAULT_TIER_SHARES).toEqual({ bulk: 70, standard: 90 });
    expect(parseTierShares({})).toEqual({ bulk: 70, standard: 90 });
    expect(
      parseTierShares({
        API_FOOTBALL_BUDGET_BULK_PERCENT: ' ',
        API_FOOTBALL_BUDGET_STANDARD_PERCENT: '',
      }),
    ).toEqual({ bulk: 70, standard: 90 });
  });

  it('reads what the deployment asked for', () => {
    expect(
      parseTierShares({
        API_FOOTBALL_BUDGET_BULK_PERCENT: '50',
        API_FOOTBALL_BUDGET_STANDARD_PERCENT: '80',
      }),
    ).toEqual({ bulk: 50, standard: 80 });
    expect(
      parseTierShares({
        API_FOOTBALL_BUDGET_BULK_PERCENT: '100',
        API_FOOTBALL_BUDGET_STANDARD_PERCENT: '100',
      }),
    ).toEqual({ bulk: 100, standard: 100 });
  });

  it('refuses a share that is not a whole percent, or bulk above standard', () => {
    for (const raw of ['0', '101', '-5', '7.5', 'most']) {
      const parsed = parseTierShares({ API_FOOTBALL_BUDGET_BULK_PERCENT: raw });
      expect(parsed).toEqual({
        error: `API_FOOTBALL_BUDGET_BULK_PERCENT=${raw} is not a whole percent from 1 to 100`,
      });
    }
    expect(parseTierShares({ API_FOOTBALL_BUDGET_STANDARD_PERCENT: '60' })).toEqual({
      error: 'API_FOOTBALL_BUDGET_BULK_PERCENT=70 is above API_FOOTBALL_BUDGET_STANDARD_PERCENT=60',
    });
  });

  it('turns a share into the count a tier stops at, rounding down', () => {
    expect(tierCeiling(7000, 'bulk', DEFAULT_TIER_SHARES)).toBe(4900);
    expect(tierCeiling(7000, 'standard', DEFAULT_TIER_SHARES)).toBe(6300);
    expect(tierCeiling(7000, 'critical', DEFAULT_TIER_SHARES)).toBe(7000);
    expect(tierCeiling(15, 'bulk', DEFAULT_TIER_SHARES)).toBe(10);
  });
});

describe('the tiered budget', () => {
  it('refuses bulk first, then standard, and keeps the rest for critical', async () => {
    const inner = counting();
    const transport = new BudgetedTransport(inner.transport, 10, undefined, DEFAULT_TIER_SHARES);

    for (let i = 0; i < 7; i += 1) expect(await send(transport, 'bulk')).toBe(200);
    expect(await send(transport, 'bulk')).toBe(429);
    expect(await send(transport, 'standard')).toBe(200);
    expect(await send(transport, 'standard')).toBe(200);
    expect(await send(transport, 'standard')).toBe(429);
    expect(await send(transport, 'critical')).toBe(200);
    expect(await send(transport, 'critical')).toBe(429);
    // The refused requests never reached the provider.
    expect(inner.calls()).toBe(10);
  });

  it('lets critical spend what bulk left, and bulk nothing past its share', async () => {
    const inner = counting();
    const transport = new BudgetedTransport(inner.transport, 10, undefined, DEFAULT_TIER_SHARES);

    for (let i = 0; i < 9; i += 1) expect(await send(transport, 'critical')).toBe(200);
    expect(await send(transport, 'bulk')).toBe(429);
    expect(await send(transport, 'standard')).toBe(429);
    expect(await send(transport, 'critical')).toBe(200);
  });

  it('names the tier and the reserve on a refusal, and notes it on the run', async () => {
    const transport = new BudgetedTransport(counting().transport, 10, undefined, {
      bulk: 50,
      standard: 90,
    });
    const tally: RequestTally = { requests: 0 };

    const refused = await withRequestTally(tally, () =>
      withBudgetTier('bulk', async () => {
        for (let i = 0; i < 5; i += 1) await transport.request('https://x.test');
        await transport.request('https://x.test');
        return transport.request('https://x.test');
      }),
    );

    expect(refused.status).toBe(429);
    const reason =
      'daily request budget: bulk requests stop at 5 of 10 (50 %), the rest is kept for live scores and line-ups';
    expect(refused.body).toEqual({ message: reason });
    expect(tally.budgetRefused).toEqual({ count: 2, reason });
  });

  it('starts from what today already spent, never lowering the count', async () => {
    const inner = counting();
    const now = new Date('2026-10-04T18:00:00Z');
    const transport = new BudgetedTransport(inner.transport, 10, () => now, DEFAULT_TIER_SHARES);

    transport.seed(7);
    expect(transport.remaining).toBe(3);
    expect(await send(transport, 'bulk')).toBe(429);
    expect(await send(transport, 'standard')).toBe(200);
    transport.seed(2);
    expect(transport.remaining).toBe(2);
  });

  it('applies the default shares to the api_football ceiling and seeds it', async () => {
    const inner = counting();
    const sources = resolveSources(
      {
        INGESTION_SOURCE: 'api_football',
        API_FOOTBALL_KEY: 'paid',
        API_FOOTBALL_DAILY_BUDGET: '10',
      },
      { transport: () => inner.transport },
    );
    const adapter = sources.forJob('fixtures')!.adapter;
    sources.seedBudget!(6);

    const kind = (result: Awaited<ReturnType<typeof adapter.getLineup>>): string =>
      result.ok ? 'ok' : result.error.kind;
    // Bulk stops at 7 of 10: one more is sent, the next is not; critical still is.
    expect(kind(await withBudgetTier('bulk', () => adapter.getLineup('1')))).not.toBe('quota');
    expect(kind(await withBudgetTier('bulk', () => adapter.getLineup('2')))).toBe('quota');
    expect(kind(await withBudgetTier('critical', () => adapter.getLineup('3')))).not.toBe('quota');
    expect(inner.calls()).toBe(2);
  });

  it('refuses the profile when a share is refused', () => {
    const sources = resolveSources({
      INGESTION_SOURCE: 'api_football',
      API_FOOTBALL_KEY: 'paid',
      API_FOOTBALL_DAILY_BUDGET: '7000',
      API_FOOTBALL_BUDGET_STANDARD_PERCENT: '150',
    });
    expect(sources.kind).toBe('off');
    expect(sources.reason).toBe(
      'API_FOOTBALL_BUDGET_STANDARD_PERCENT=150 is not a whole percent from 1 to 100',
    );
  });

  it('has nothing to seed without a ceiling of its own', () => {
    const sources = resolveSources({ INGESTION_SOURCE: 'api_football', API_FOOTBALL_KEY: 'paid' });
    expect(sources.seedBudget).toBeUndefined();
  });
});

describe('the run record of a budget refusal', () => {
  it('leads with the budget, keeping what the job said', () => {
    const tally: RequestTally = {
      requests: 3,
      budgetRefused: { count: 2, reason: 'bulk requests stop at 4900' },
    };
    expect(withBudgetNote('9: quota: HTTP 429', tally)).toBe(
      'budget: 2 requests not sent -- bulk requests stop at 4900; 9: quota: HTTP 429',
    );
    expect(
      withBudgetNote(undefined, { requests: 0, budgetRefused: { count: 1, reason: 'r' } }),
    ).toBe('budget: 1 request not sent -- r');
  });

  it('leaves a run the budget did not touch as it was', () => {
    expect(withBudgetNote(undefined, { requests: 4 })).toBeUndefined();
    expect(withBudgetNote('x', { requests: 4 })).toBe('x');
  });
});

describe('a run held back by the budget (T-1365)', () => {
  type Finished = { status: string; error: string | null; requests: number | null };

  /** The run service over a budget of 10, whose store says 8 were sent today. */
  async function seeded(): Promise<{
    runs: IngestRunsService;
    adapter: ProviderAdapter;
    finished: Finished[];
    calls: () => number;
  }> {
    const inner = counting();
    const sources = resolveSources(
      {
        INGESTION_SOURCE: 'api_football',
        API_FOOTBALL_KEY: 'paid',
        API_FOOTBALL_DAILY_BUDGET: '10',
      },
      { transport: () => inner.transport },
    );
    const finished: Finished[] = [];
    const store = {
      start: async () => 'run-1',
      finish: async (_id: string, outcome: Finished) => {
        finished.push(outcome);
        return null;
      },
      requestsSince: async () => 8,
    } as unknown as PostgresRunStore;
    const runs = new IngestRunsService(store, sources);
    await runs.onModuleInit();
    return { runs, adapter: sources.forJob('live')!.adapter, finished, calls: inner.calls };
  }

  it('records a bulk run past its share as partial, naming the budget', async () => {
    const { runs, adapter, finished, calls } = await seeded();

    await runs.track('api_football', 'squads', null, async () => {
      const result = await adapter.getLineup('1');
      return {
        result: null,
        itemsSeen: 0,
        itemsWritten: 0,
        ...(result.ok ? {} : { partial: `1: ${result.error.kind}` }),
      };
    });

    // 8 of 10 spent before the restart: past bulk's 7, so nothing was sent.
    expect(calls()).toBe(0);
    expect(finished).toHaveLength(1);
    expect(finished[0]!.status).toBe('partial');
    expect(finished[0]!.error).toBe(
      'budget: 1 request not sent -- daily request budget: bulk requests stop at 7 of 10 (70 %), ' +
        'the rest is kept for live scores and line-ups; 1: quota',
    );
    expect(finished[0]!.requests).toBe(0);
  });

  it('still sends a live run from the reserve', async () => {
    const { runs, adapter, finished, calls } = await seeded();

    await runs.track('api_football', 'live', null, async () => {
      await adapter.getLineup('1');
      return { result: null, itemsSeen: 0, itemsWritten: 0 };
    });

    expect(calls()).toBe(1);
    expect(finished[0]!.status).toBe('succeeded');
    expect(finished[0]!.requests).toBe(1);
  });
});
