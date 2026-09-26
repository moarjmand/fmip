/**
 * The interface every provider adapter implements (02-architecture.md, "The
 * adapter layer"). Swapping a provider is: one directory here, pass the
 * contract check, change one config value. Nothing outside `packages/ingestion`
 * knows a provider's field names.
 */

import type {
  NormalisedAbsence,
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
  /**
   * Ask for every fixture of the season instead, where the provider answers
   * that in one request (T-505): a season's recorded end is only as far as
   * its published schedule reached when it was recorded, and a question
   * bounded by it would never learn of the rest. A provider that charges by
   * the day reads `from` and `to` as before.
   */
  wholeSeason?: boolean;
}

export interface LiveQuery {
  fixtureExternalIds: string[];
}

export interface StandingsQuery {
  competitionExternalId: string;
  seasonLabel: string;
}

/** The six capabilities the ingestion jobs (T-026, T-103) need. */
export interface ProviderAdapter {
  readonly manifest: AdapterManifest;
  listFixtures(query: FixtureQuery): Promise<AdapterResult<NormalisedFixture[]>>;
  getLive(query: LiveQuery): Promise<AdapterResult<NormalisedFixture[]>>;
  getLineup(fixtureExternalId: string): Promise<AdapterResult<NormalisedLineup>>;
  getStandings(query: StandingsQuery): Promise<AdapterResult<NormalisedStanding[]>>;
  getFixtureDetail(fixtureExternalId: string): Promise<AdapterResult<NormalisedFixtureDetail>>;
  /**
   * Who will or may miss a match, as the provider reports it before kick-off
   * (T-103). An empty list is the provider saying nobody; a provider that
   * does not report availability answers `unsupported`.
   */
  getAvailability(fixtureExternalId: string): Promise<AdapterResult<NormalisedAbsence[]>>;
}

export type AdapterCall = keyof Omit<ProviderAdapter, 'manifest'>;

export const ADAPTER_CALLS: readonly AdapterCall[] = [
  'listFixtures',
  'getLive',
  'getLineup',
  'getStandings',
  'getFixtureDetail',
  'getAvailability',
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
