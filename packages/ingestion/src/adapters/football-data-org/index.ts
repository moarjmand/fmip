/**
 * football-data.org adapter (T-022): v4, written against the free tier
 * (TIER_ONE: twelve competitions, 10 requests/minute, delayed scores; lineups,
 * bookings and substitutions are paid and therefore `unsupported` here).
 *
 * The adapter never reaches the network itself and never throws; provider
 * field names stay in `map.ts`.
 */

import type {
  NormalisedFixture,
  NormalisedFixtureDetail,
  NormalisedLineup,
  NormalisedStanding,
} from '../../normalised';
import type {
  AdapterConfig,
  AdapterError,
  AdapterFactory,
  AdapterManifest,
  AdapterResult,
  FixtureQuery,
  LiveQuery,
  ProviderAdapter,
  StandingsQuery,
  Transport,
  TransportResponse,
} from '../_contract';
import { isRecord, mapFixture, mapIncidents, mapLineup, mapStandings, seasonYear } from './map';

export const FOOTBALL_DATA_ORG_BASE_URL = 'https://api.football-data.org/v4';

/** `/matches?ids=` is documented without a cap; chunked defensively. */
const MAX_IDS_PER_REQUEST = 20;

export const FOOTBALL_DATA_ORG_MANIFEST: AdapterManifest = {
  provider: 'football_data_org',
  displayName: 'football-data.org',
  criticalPath: true,
  licence: {
    kind: 'licensed_api',
    termsUrl: 'https://www.football-data.org/terms',
    tier: 'free (TIER_ONE)',
  },
  degradable: false,
  quota: { requestsPerDay: null, requestsPerMinute: 10 },
};

/**
 * Non-200 answers carry `{ message, errorCode }`. 403 is the tier saying no
 * (a restricted competition or resource), 429 the minute quota.
 */
function failure(response: TransportResponse): AdapterError {
  const message =
    isRecord(response.body) && typeof response.body.message === 'string'
      ? response.body.message
      : `HTTP ${response.status}`;
  const kind: AdapterError['kind'] =
    response.status === 429 ? 'quota' : response.status === 403 ? 'unsupported' : 'http';
  return { kind, message, status: response.status };
}

class FootballDataOrgAdapter implements ProviderAdapter {
  readonly manifest = FOOTBALL_DATA_ORG_MANIFEST;

  constructor(
    private readonly transport: Transport,
    private readonly config: AdapterConfig,
  ) {}

  private async call(
    path: string,
    params: Record<string, string> = {},
  ): Promise<
    | { ok: true; body: Record<string, unknown>; receivedAt: string }
    | { ok: false; error: AdapterError }
  > {
    const query = new URLSearchParams(params).toString();
    const url = `${FOOTBALL_DATA_ORG_BASE_URL}${path}${query === '' ? '' : `?${query}`}`;
    let response: TransportResponse;
    try {
      response = await this.transport.request(url, {
        method: 'GET',
        headers: this.config.apiKey === null ? {} : { 'X-Auth-Token': this.config.apiKey },
      });
    } catch (error: unknown) {
      return {
        ok: false,
        error: {
          kind: 'transport',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    if (response.status !== 200) return { ok: false, error: failure(response) };
    if (!isRecord(response.body)) {
      return { ok: false, error: { kind: 'malformed', message: 'body is not a JSON object' } };
    }
    return { ok: true, body: response.body, receivedAt: response.receivedAt };
  }

  private badSeason(label: string): AdapterResult<never> {
    return {
      ok: false,
      error: { kind: 'unsupported', message: `cannot read a season from "${label}"` },
      requests: 0,
    };
  }

  async listFixtures(query: FixtureQuery): Promise<AdapterResult<NormalisedFixture[]>> {
    const season = seasonYear(query.seasonLabel);
    if (season === null) return this.badSeason(query.seasonLabel);
    const result = await this.call(`/competitions/${query.competitionExternalId}/matches`, {
      season: String(season),
      dateFrom: query.from,
      dateTo: query.to,
    });
    if (!result.ok) return { ok: false, error: result.error, requests: 1 };
    const matches = Array.isArray(result.body.matches) ? result.body.matches : [];
    const data = matches
      .map((m) => mapFixture(m, result.receivedAt))
      .filter((f): f is NormalisedFixture => f !== null);
    return { ok: true, data, requests: 1, fetchedAt: result.receivedAt };
  }

  async getLive(query: LiveQuery): Promise<AdapterResult<NormalisedFixture[]>> {
    const ids = [...new Set(query.fixtureExternalIds)];
    if (ids.length === 0) {
      return { ok: true, data: [], requests: 0, fetchedAt: new Date().toISOString() };
    }
    const data: NormalisedFixture[] = [];
    let requests = 0;
    let fetchedAt = '';
    for (let i = 0; i < ids.length; i += MAX_IDS_PER_REQUEST) {
      const chunk = ids.slice(i, i + MAX_IDS_PER_REQUEST);
      const result = await this.call('/matches', { ids: chunk.join(',') });
      requests += 1;
      if (!result.ok) return { ok: false, error: result.error, requests };
      fetchedAt = result.receivedAt;
      const matches = Array.isArray(result.body.matches) ? result.body.matches : [];
      for (const m of matches) {
        const fixture = mapFixture(m, result.receivedAt);
        if (fixture !== null) data.push(fixture);
      }
    }
    return { ok: true, data, requests, fetchedAt };
  }

  async getLineup(fixtureExternalId: string): Promise<AdapterResult<NormalisedLineup>> {
    const result = await this.call(`/matches/${fixtureExternalId}`);
    if (!result.ok) return { ok: false, error: result.error, requests: 1 };
    const lineup = mapLineup(result.body);
    if (lineup === null) {
      return {
        ok: false,
        error: {
          kind: 'unsupported',
          message: `no lineup for match ${fixtureExternalId} (lineups are not on this tier)`,
        },
        requests: 1,
      };
    }
    return { ok: true, data: lineup, requests: 1, fetchedAt: result.receivedAt };
  }

  async getStandings(query: StandingsQuery): Promise<AdapterResult<NormalisedStanding[]>> {
    const season = seasonYear(query.seasonLabel);
    if (season === null) return this.badSeason(query.seasonLabel);
    const result = await this.call(`/competitions/${query.competitionExternalId}/standings`, {
      season: String(season),
    });
    if (!result.ok) return { ok: false, error: result.error, requests: 1 };
    return {
      ok: true,
      data: mapStandings(result.body, result.receivedAt),
      requests: 1,
      fetchedAt: result.receivedAt,
    };
  }

  async getFixtureDetail(
    fixtureExternalId: string,
  ): Promise<AdapterResult<NormalisedFixtureDetail>> {
    const result = await this.call(`/matches/${fixtureExternalId}`);
    if (!result.ok) return { ok: false, error: result.error, requests: 1 };
    const fixture = mapFixture(result.body, result.receivedAt);
    if (fixture === null) {
      return {
        ok: false,
        error: {
          kind: 'malformed',
          message: `match ${fixtureExternalId} is missing required fields`,
        },
        requests: 1,
      };
    }
    const detail: NormalisedFixtureDetail = {
      fixture,
      incidents: mapIncidents(result.body, fixture.home.externalId),
      lineup: mapLineup(result.body),
      // Match statistics are a paid add-on the free tier does not carry.
      statistics: [],
      periods: [],
    };
    return { ok: true, data: detail, requests: 1, fetchedAt: result.receivedAt };
  }
}

export const createFootballDataOrgAdapter: AdapterFactory = (transport, config) =>
  new FootballDataOrgAdapter(transport, config);
