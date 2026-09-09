/**
 * The interface every provider adapter implements (02-architecture.md, "The
 * adapter layer"). Swapping a provider is: one directory here, pass the
 * contract check, change one config value. Nothing outside `packages/ingestion`
 * knows a provider's field names.
 */

import type {
  NormalisedFixture,
  NormalisedFixtureDetail,
  NormalisedLineup,
  NormalisedStanding,
  Provider,
} from '../normalised';

/**
 * What an adapter declares about itself. The contract check enforces D-014
 * from these fields: an adapter on the critical path must be a licensed API.
 */
export interface AdapterManifest {
  provider: Provider;
  displayName: string;
  /** Serves scores, incidents, lineups, tables or identity (D-014 tier 1). */
  criticalPath: boolean;
  licence: {
    kind: 'licensed_api' | 'open_data' | 'scraped';
    /** Where the terms this adapter operates under can be read. */
    termsUrl: string;
    /** The plan this adapter is written against, e.g. "free", "pro". */
    tier: string;
  };
  /** May be absent without breaking a page (D-014 tier 2). Never true for the critical path. */
  degradable: boolean;
  quota: {
    requestsPerDay: number | null;
    requestsPerMinute: number | null;
  };
}

/**
 * The only way an adapter reaches the network. Injected, so the contract
 * check can replay recorded responses and the bake-off can count requests.
 */
export interface Transport {
  request(url: string, init?: TransportInit): Promise<TransportResponse>;
}

export interface TransportInit {
  method?: 'GET';
  headers?: Record<string, string>;
}

export interface TransportResponse {
  status: number;
  /** Parsed JSON, or the raw text when the body was not JSON. */
  body: unknown;
  /** ISO 8601, when the response arrived. */
  receivedAt: string;
}

export type AdapterErrorKind = 'http' | 'malformed' | 'quota' | 'unsupported' | 'transport';

export interface AdapterError {
  kind: AdapterErrorKind;
  message: string;
  status?: number;
}

/**
 * Every adapter call returns one of these. `requests` is the number of
 * transport calls made, which the bake-off turns into quota efficiency.
 * Failure is a value, not an exception: the caller decides what "the provider
 * is down" means for the coverage state.
 */
export type AdapterResult<T> =
  | { ok: true; data: T; requests: number; fetchedAt: string }
  | { ok: false; error: AdapterError; requests: number };

export interface FixtureQuery {
  competitionExternalId: string;
  seasonLabel: string;
  /** Inclusive, ISO date (YYYY-MM-DD). */
  from: string;
  /** Inclusive, ISO date (YYYY-MM-DD). */
  to: string;
}

export interface LiveQuery {
  fixtureExternalIds: string[];
}

export interface StandingsQuery {
  competitionExternalId: string;
  seasonLabel: string;
}

/** The five capabilities the ingestion jobs (T-026) need. */
export interface ProviderAdapter {
  readonly manifest: AdapterManifest;
  listFixtures(query: FixtureQuery): Promise<AdapterResult<NormalisedFixture[]>>;
  getLive(query: LiveQuery): Promise<AdapterResult<NormalisedFixture[]>>;
  getLineup(fixtureExternalId: string): Promise<AdapterResult<NormalisedLineup>>;
  getStandings(query: StandingsQuery): Promise<AdapterResult<NormalisedStanding[]>>;
  getFixtureDetail(fixtureExternalId: string): Promise<AdapterResult<NormalisedFixtureDetail>>;
}

export type AdapterCall = keyof Omit<ProviderAdapter, 'manifest'>;

export const ADAPTER_CALLS: readonly AdapterCall[] = [
  'listFixtures',
  'getLive',
  'getLineup',
  'getStandings',
  'getFixtureDetail',
];

export interface AdapterConfig {
  /** `null` for providers that need no key, or when recording is not possible. */
  apiKey: string | null;
}

/**
 * How an adapter is constructed. The transport is the seam the contract check
 * and the bake-off both use; an adapter must never reach for `fetch` itself.
 */
export type AdapterFactory = (transport: Transport, config: AdapterConfig) => ProviderAdapter;
