/**
 * Runs the three adapters over the same fixture set and measures them
 * (T-024). Two modes share every line of measurement code:
 *
 *   - **live**: a `TimedTransport` around `fetch`, real keys, response times.
 *   - **recorded**: `ReplayTransport` over the `_fixtures` recordings, no
 *     network, no latency; what the recordings contain is what is measured.
 *
 * Goal latency, lineup lead time and lineup accuracy need a polling job
 * running across match days (T-026); this harness names them as not measured
 * rather than estimating them.
 */

import type {
  AdapterCall,
  AdapterFactory,
  AdapterResult,
  FixtureQuery,
  ProviderAdapter,
  Transport,
  TransportInit,
  TransportResponse,
} from '../adapters/_contract';
import type { NormalisedFixture, Provider } from '../normalised';
import { type Scenario } from '../harness/contract-check';
import { ReplayTransport } from '../harness/replay-transport';
import {
  type Completeness,
  type Disagreement,
  EMPTY,
  add,
  detailCompleteness,
  disagreements,
  fixtureCompleteness,
  lineupCompleteness,
  percent,
  standingCompleteness,
} from './metrics';

export const NOT_MEASURED = [
  'goal latency (needs the live polling job, T-026)',
  'lineup lead time (needs polling across match days)',
  'lineup accuracy (needs an official post-match record to diff against)',
] as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** A `Transport` that times each request and delegates to `fetch`. */
export class TimedTransport implements Transport {
  readonly latenciesMs: number[] = [];

  constructor(private readonly fetchImpl: typeof fetch = fetch) {}

  async request(url: string, init: TransportInit = {}): Promise<TransportResponse> {
    const started = Date.now();
    const response = await this.fetchImpl(url, {
      method: init.method ?? 'GET',
      headers: init.headers,
    });
    const text = await response.text();
    this.latenciesMs.push(Date.now() - started);
    let body: unknown = text;
    try {
      body = JSON.parse(text) as unknown;
    } catch {
      // not JSON; the adapter reports it as malformed
    }
    return { status: response.status, body, receivedAt: new Date().toISOString() };
  }
}

export interface CallRecord {
  provider: Provider;
  call: AdapterCall;
  /** The scenario or competition the call belonged to. */
  label: string;
  ok: boolean;
  errorKind: string | null;
  requests: number;
  items: number;
  latencyMs: number | null;
}

export interface ProviderSummary {
  provider: Provider;
  displayName: string;
  tier: string;
  calls: number;
  ok: number;
  errors: Record<string, number>;
  requests: number;
  /** Mean response time per request, live mode only. */
  meanLatencyMs: number | null;
  completeness: {
    fixture: number | null;
    lineup: number | null;
    detail: number | null;
    standing: number | null;
  };
}

export interface BakeoffResult {
  ranAt: string;
  mode: 'live' | 'recorded';
  fixtureSet: string;
  summaries: ProviderSummary[];
  calls: CallRecord[];
  disagreements: Disagreement[];
  notMeasured: readonly string[];
}

/** One competition of the fixture set, with each provider's id for it. */
export interface CompetitionPlan {
  label: string;
  ids: Partial<Record<Provider, string>>;
  seasonLabel: string;
  from: string;
  to: string;
}

export interface LivePlan {
  fixtureSet: string;
  competitions: CompetitionPlan[];
  /** How many fixtures per competition get a detail and a lineup call. */
  detailSample: number;
}

export interface ProviderUnderTest {
  factory: AdapterFactory;
  apiKey: string | null;
}

interface Tally {
  fixture: Completeness;
  lineup: Completeness;
  detail: Completeness;
  standing: Completeness;
  fixtures: NormalisedFixture[];
}

const freshTally = (): Tally => ({
  fixture: EMPTY,
  lineup: EMPTY,
  detail: EMPTY,
  standing: EMPTY,
  fixtures: [],
});

function record(
  provider: Provider,
  call: AdapterCall,
  label: string,
  result: AdapterResult<unknown>,
  latencyMs: number | null,
  tally: Tally,
): CallRecord {
  let items = 0;
  if (result.ok) {
    const data = result.data;
    switch (call) {
      case 'listFixtures':
      case 'getLive': {
        const fixtures = data as NormalisedFixture[];
        items = fixtures.length;
        for (const f of fixtures) tally.fixture = add(tally.fixture, fixtureCompleteness(f));
        if (call === 'listFixtures') tally.fixtures.push(...fixtures);
        break;
      }
      case 'getStandings': {
        const standings = data as Parameters<typeof standingCompleteness>[0][];
        items = standings.length;
        for (const s of standings) tally.standing = add(tally.standing, standingCompleteness(s));
        break;
      }
      case 'getLineup':
        items = 1;
        tally.lineup = add(
          tally.lineup,
          lineupCompleteness(data as Parameters<typeof lineupCompleteness>[0]),
        );
        break;
      case 'getFixtureDetail':
        items = 1;
        tally.detail = add(
          tally.detail,
          detailCompleteness(data as Parameters<typeof detailCompleteness>[0]),
        );
        break;
    }
  }
  return {
    provider,
    call,
    label,
    ok: result.ok,
    errorKind: result.ok ? null : result.error.kind,
    requests: result.requests,
    items,
    latencyMs,
  };
}

function summarise(
  adapter: ProviderAdapter,
  calls: CallRecord[],
  tally: Tally,
  latencies: number[],
): ProviderSummary {
  const errors: Record<string, number> = {};
  for (const c of calls) {
    if (c.errorKind !== null) errors[c.errorKind] = (errors[c.errorKind] ?? 0) + 1;
  }
  return {
    provider: adapter.manifest.provider,
    displayName: adapter.manifest.displayName,
    tier: adapter.manifest.licence.tier,
    calls: calls.length,
    ok: calls.filter((c) => c.ok).length,
    errors,
    requests: calls.reduce((n, c) => n + c.requests, 0),
    meanLatencyMs:
      latencies.length === 0
        ? null
        : Math.round(latencies.reduce((a, b) => a + b, 0) / latencies.length),
    completeness: {
      fixture: percent(tally.fixture),
      lineup: percent(tally.lineup),
      detail: percent(tally.detail),
      standing: percent(tally.standing),
    },
  };
}

/**
 * Live mode: every provider gets the same competitions and dates; each
 * provider's own fixture ids feed its detail, lineup and live calls.
 */
export async function runLive(
  providers: ProviderUnderTest[],
  plan: LivePlan,
  fetchImpl: typeof fetch = fetch,
): Promise<BakeoffResult> {
  const calls: CallRecord[] = [];
  const summaries: ProviderSummary[] = [];
  const fixturesByProvider: Record<string, NormalisedFixture[]> = {};

  for (const { factory, apiKey } of providers) {
    const transport = new TimedTransport(fetchImpl);
    const adapter = factory(transport, { apiKey });
    const provider = adapter.manifest.provider;
    const tally = freshTally();
    const own: CallRecord[] = [];
    // Stay under the provider's per-minute quota: one slot per request made.
    const rpm = adapter.manifest.quota.requestsPerMinute;
    const slotMs = rpm === null ? 0 : Math.ceil(60_000 / rpm);

    const timed = async <T>(
      call: AdapterCall,
      label: string,
      run: () => Promise<AdapterResult<T>>,
    ): Promise<AdapterResult<T>> => {
      const before = transport.latenciesMs.length;
      const result = await run();
      const spent = transport.latenciesMs.slice(before);
      const latency = spent.length === 0 ? null : spent.reduce((a, b) => a + b, 0);
      own.push(record(provider, call, label, result, latency, tally));
      if (slotMs > 0 && result.requests > 0) await sleep(slotMs * result.requests);
      return result;
    };

    for (const competition of plan.competitions) {
      const id = competition.ids[provider];
      if (id === undefined) continue;
      const query: FixtureQuery = {
        competitionExternalId: id,
        seasonLabel: competition.seasonLabel,
        from: competition.from,
        to: competition.to,
      };
      const listed = await timed('listFixtures', competition.label, () =>
        adapter.listFixtures(query),
      );
      await timed('getStandings', competition.label, () =>
        adapter.getStandings({ competitionExternalId: id, seasonLabel: competition.seasonLabel }),
      );
      if (!listed.ok) continue;
      const sample = listed.data.slice(0, plan.detailSample);
      for (const fixture of sample) {
        const label = `${competition.label}: ${fixture.home.name} v ${fixture.away.name}`;
        await timed('getFixtureDetail', label, () => adapter.getFixtureDetail(fixture.externalId));
        await timed('getLineup', label, () => adapter.getLineup(fixture.externalId));
      }
      if (sample.length > 0) {
        await timed('getLive', competition.label, () =>
          adapter.getLive({ fixtureExternalIds: sample.map((f) => f.externalId) }),
        );
      }
    }

    fixturesByProvider[provider] = tally.fixtures;
    calls.push(...own);
    summaries.push(summarise(adapter, own, tally, transport.latenciesMs));
  }

  return {
    ranAt: new Date().toISOString(),
    mode: 'live',
    fixtureSet: plan.fixtureSet,
    summaries,
    calls,
    disagreements: disagreements(fixturesByProvider),
    notMeasured: NOT_MEASURED,
  };
}

/** Recorded mode: each provider's scenarios, replayed. Deterministic. */
export async function runRecorded(
  providers: { factory: AdapterFactory; scenarios: readonly Scenario[] }[],
  fixtureSet: string,
): Promise<BakeoffResult> {
  const calls: CallRecord[] = [];
  const summaries: ProviderSummary[] = [];
  const fixturesByProvider: Record<string, NormalisedFixture[]> = {};
  let ranAt = '';

  for (const { factory, scenarios } of providers) {
    const tally = freshTally();
    const own: CallRecord[] = [];
    let adapter: ProviderAdapter | null = null;
    for (const scenario of scenarios) {
      const transport = new ReplayTransport(scenario.requests, scenario.recordedAt);
      adapter = factory(transport, { apiKey: null });
      const call = adapter[scenario.call] as (
        ...args: unknown[]
      ) => Promise<AdapterResult<unknown>>;
      const result = await call.apply(adapter, scenario.args);
      own.push(
        record(adapter.manifest.provider, scenario.call, scenario.name, result, null, tally),
      );
      if (scenario.recordedAt > ranAt) ranAt = scenario.recordedAt;
    }
    if (adapter === null) continue;
    fixturesByProvider[adapter.manifest.provider] = tally.fixtures;
    calls.push(...own);
    summaries.push(summarise(adapter, own, tally, []));
  }

  return {
    ranAt: ranAt || new Date(0).toISOString(),
    mode: 'recorded',
    fixtureSet,
    summaries,
    calls,
    disagreements: disagreements(fixturesByProvider),
    notMeasured: NOT_MEASURED,
  };
}
