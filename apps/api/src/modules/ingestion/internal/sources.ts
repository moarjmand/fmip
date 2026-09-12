/**
 * Which provider answers which ingestion job (T-026, D-049).
 *
 * Pure configuration: it reads the environment and hands back one adapter per
 * job, or says why there is none. No Nest, no database, no network at
 * construction time, so the rules below are tested without any of them.
 *
 * Until a paid plan exists (T-025 is deferred, D-033) the live profile is two
 * free providers split by module, never blended: football-data.org has the
 * breadth (all five target leagues plus the Champions League, current season,
 * 10 requests a minute, no daily cap) and no lineups or incidents at all;
 * Highlightly has the depth (lineups, incidents, a live clock) inside a hard
 * 100 requests a day. What neither reaches is `not_supplied`, which is T-027's
 * job to record.
 */

import {
  REPLAY_QUERY,
  TimedTransport,
  createFootballDataOrgAdapter,
  createHighlightlyAdapter,
  createReplayAdapter,
  replayAvailable,
  type Provider,
  type ProviderAdapter,
  type Transport,
  type TransportInit,
  type TransportResponse,
} from '@fmip/ingestion';

/** Re-exported so the jobs ask the replay source for exactly what was recorded. */
export { REPLAY_QUERY };

/** The injection token for the resolved sources. Provided by `IngestionModule`. */
export const INGESTION_SOURCES = Symbol('INGESTION_SOURCES');

/** The five scheduled jobs (T-026). */
export const INGEST_JOBS = ['fixtures', 'live', 'lineups', 'standings', 'post_match'] as const;
export type IngestJob = (typeof INGEST_JOBS)[number];

export type SourceKind = 'replay' | 'live' | 'off';

export interface JobSource {
  provider: Provider;
  adapter: ProviderAdapter;
}

export interface IngestionSources {
  kind: SourceKind;
  /** Why nothing is configured, for the run record and the health view. */
  reason: string | null;
  /** The adapter for a job, or `null` when no configured provider serves it. */
  forJob(job: IngestJob): JobSource | null;
}

/** The provider whose recordings the replay profile uses: the only rich set. */
export const REPLAY_PROVIDER: Provider = 'api_football';

export interface SourceEnv {
  INGESTION_SOURCE?: string;
  FOOTBALL_DATA_ORG_KEY?: string;
  HIGHLIGHTLY_KEY?: string;
  HIGHLIGHTLY_DAILY_BUDGET?: string;
}

/** Highlightly's free plan, and the default ceiling the budget transport holds. */
export const HIGHLIGHTLY_DEFAULT_BUDGET = 100;

/**
 * A transport that refuses once a day's requests are spent.
 *
 * Over budget it answers 429 rather than throwing, so the adapter reports a
 * `quota` error the way it would for a real refusal and the job records a
 * partial run naming the budget — the ceiling is enforced in code, not in
 * hope (D-049). The day is UTC, which is when every free plan resets.
 */
export class BudgetedTransport implements Transport {
  private day: string;
  private spent = 0;

  constructor(
    private readonly inner: Transport,
    private readonly perDay: number,
    private readonly now: () => Date = () => new Date(),
  ) {
    this.day = this.today();
  }

  /** Requests still available today. */
  get remaining(): number {
    this.roll();
    return Math.max(0, this.perDay - this.spent);
  }

  async request(url: string, init?: TransportInit): Promise<TransportResponse> {
    this.roll();
    if (this.spent >= this.perDay) {
      return {
        status: 429,
        body: { message: `daily request budget of ${this.perDay} spent` },
        receivedAt: this.now().toISOString(),
      };
    }
    this.spent += 1;
    return this.inner.request(url, init);
  }

  private today(): string {
    return this.now().toISOString().slice(0, 10);
  }

  private roll(): void {
    const today = this.today();
    if (today !== this.day) {
      this.day = today;
      this.spent = 0;
    }
  }
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function off(reason: string): IngestionSources {
  return { kind: 'off', reason, forJob: () => null };
}

/**
 * Builds the sources for this process. Called once at startup; the adapters it
 * returns are stateless apart from the Highlightly budget, which is why the
 * transport, not the adapter, is where the counter lives.
 */
export function resolveSources(
  env: SourceEnv,
  options: { recordingsRoot?: string; transport?: () => Transport } = {},
): IngestionSources {
  const requested = (env.INGESTION_SOURCE ?? 'replay').trim().toLowerCase();

  if (requested === 'off') return off('INGESTION_SOURCE=off');

  if (requested === 'replay') {
    if (!replayAvailable(REPLAY_PROVIDER, options.recordingsRoot)) {
      return off('INGESTION_SOURCE=replay, but no recordings are present in this build');
    }
    const source: JobSource = {
      provider: REPLAY_PROVIDER,
      adapter: createReplayAdapter(REPLAY_PROVIDER, options.recordingsRoot),
    };
    return { kind: 'replay', reason: null, forJob: () => source };
  }

  if (requested !== 'live') {
    return off(`INGESTION_SOURCE=${requested} is not one of replay, live, off`);
  }

  const make = options.transport ?? ((): Transport => new TimedTransport());

  const spine: JobSource | null =
    env.FOOTBALL_DATA_ORG_KEY === undefined || env.FOOTBALL_DATA_ORG_KEY === ''
      ? null
      : {
          provider: 'football_data_org',
          adapter: createFootballDataOrgAdapter(make(), { apiKey: env.FOOTBALL_DATA_ORG_KEY }),
        };

  const detail: JobSource | null =
    env.HIGHLIGHTLY_KEY === undefined || env.HIGHLIGHTLY_KEY === ''
      ? null
      : {
          provider: 'highlightly',
          adapter: createHighlightlyAdapter(
            new BudgetedTransport(
              make(),
              positiveInt(env.HIGHLIGHTLY_DAILY_BUDGET, HIGHLIGHTLY_DEFAULT_BUDGET),
            ),
            { apiKey: env.HIGHLIGHTLY_KEY },
          ),
        };

  if (spine === null && detail === null) {
    return off(
      'INGESTION_SOURCE=live, but neither FOOTBALL_DATA_ORG_KEY nor HIGHLIGHTLY_KEY is set',
    );
  }

  return {
    kind: 'live',
    reason:
      spine === null
        ? 'no FOOTBALL_DATA_ORG_KEY: fixtures, live and standings have no source'
        : detail === null
          ? 'no HIGHLIGHTLY_KEY: lineups and incidents have no source'
          : null,
    forJob: (job) => (job === 'lineups' || job === 'post_match' ? detail : spine),
  };
}
