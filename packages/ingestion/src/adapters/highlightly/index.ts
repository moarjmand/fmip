/**
 * Highlightly adapter (T-023): sports.highlightly.net/football on the BASIC
 * (free) plan, 100 requests/day. The direct API wants RapidAPI-style headers
 * (`x-rapidapi-key` and `x-rapidapi-host`), verified live on 2026-09-10.
 *
 * Request cost differs from the other two providers and is reported
 * honestly: a fixture list is one request per day in the range, and the live
 * call is one request per fixture, because the API has no batch lookup.
 * Provider field names stay in `map.ts`.
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
import {
  isRecord,
  mapFixture,
  mapIncidents,
  mapLineup,
  mapStandings,
  mapStatistics,
  seasonYear,
} from './map';

export const HIGHLIGHTLY_BASE_URL = 'https://sports.highlightly.net/football';
export const HIGHLIGHTLY_HOST = 'sports.highlightly.net';

/** A fixture list is one request per day; longer ranges are refused, not paid for silently. */
export const MAX_RANGE_DAYS = 14;
/** The live call is one request per fixture; more than this is refused. */
export const MAX_LIVE_IDS = 20;

export const HIGHLIGHTLY_MANIFEST: AdapterManifest = {
  provider: 'highlightly',
  displayName: 'Highlightly',
  criticalPath: true,
  licence: {
    kind: 'licensed_api',
    // Terms are linked from the site footer; there is no stable deep link.
    termsUrl: 'https://highlightly.net/',
    tier: 'BASIC (free)',
  },
  degradable: false,
  quota: { requestsPerDay: 100, requestsPerMinute: null },
};

function failure(response: TransportResponse): AdapterError {
  const body = isRecord(response.body) ? response.body : {};
  const message = typeof body.error === 'string' ? body.error : `HTTP ${response.status}`;
  const kind: AdapterError['kind'] =
    response.status === 429 ? 'quota' : response.status === 403 ? 'unsupported' : 'http';
  return { kind, message, status: response.status };
}

/** Every calendar day from `from` to `to` inclusive, as YYYY-MM-DD. */
export function daysBetween(from: string, to: string): string[] | null {
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  const days: string[] = [];
  for (let t = start; t <= end; t += 86_400_000) days.push(new Date(t).toISOString().slice(0, 10));
  return days;
}

class HighlightlyAdapter implements ProviderAdapter {
  readonly manifest = HIGHLIGHTLY_MANIFEST;

  constructor(
    private readonly transport: Transport,
    private readonly config: AdapterConfig,
  ) {}

  private async call(
    path: string,
    params: Record<string, string> = {},
  ): Promise<{ ok: true; body: unknown; receivedAt: string } | { ok: false; error: AdapterError }> {
    const query = new URLSearchParams(params).toString();
    const url = `${HIGHLIGHTLY_BASE_URL}${path}${query === '' ? '' : `?${query}`}`;
    let response: TransportResponse;
    try {
      response = await this.transport.request(url, {
        method: 'GET',
        headers: {
          'x-rapidapi-host': HIGHLIGHTLY_HOST,
          ...(this.config.apiKey === null ? {} : { 'x-rapidapi-key': this.config.apiKey }),
        },
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
    return { ok: true, body: response.body, receivedAt: response.receivedAt };
  }

  private unsupported<T>(message: string, requests = 0): AdapterResult<T> {
    return { ok: false, error: { kind: 'unsupported', message }, requests };
  }

  async listFixtures(query: FixtureQuery): Promise<AdapterResult<NormalisedFixture[]>> {
    const season = seasonYear(query.seasonLabel);
    if (season === null)
      return this.unsupported(`cannot read a season from "${query.seasonLabel}"`);
    const days = daysBetween(query.from, query.to);
    if (days === null) return this.unsupported(`bad date range ${query.from}..${query.to}`);
    if (days.length > MAX_RANGE_DAYS) {
      return this.unsupported(
        `${days.length} days is one request per day; the adapter stops at ${MAX_RANGE_DAYS}`,
      );
    }
    const data: NormalisedFixture[] = [];
    let requests = 0;
    let fetchedAt = '';
    for (const date of days) {
      const result = await this.call('/matches', {
        leagueId: query.competitionExternalId,
        season: String(season),
        date,
        limit: '100',
      });
      requests += 1;
      if (!result.ok) return { ok: false, error: result.error, requests };
      fetchedAt = result.receivedAt;
      const items =
        isRecord(result.body) && Array.isArray(result.body.data) ? result.body.data : null;
      if (items === null) {
        return {
          ok: false,
          error: { kind: 'malformed', message: `no data array for ${date}` },
          requests,
        };
      }
      for (const item of items) {
        const fixture = mapFixture(item, result.receivedAt);
        if (fixture !== null) data.push(fixture);
      }
    }
    return { ok: true, data, requests, fetchedAt };
  }

  /** `/matches/{id}` answers an array with the match, or an empty array. */
  private async matchById(
    fixtureExternalId: string,
  ): Promise<
    | { ok: true; item: Record<string, unknown>; fixture: NormalisedFixture; receivedAt: string }
    | { ok: false; error: AdapterError }
  > {
    const result = await this.call(`/matches/${fixtureExternalId}`);
    if (!result.ok) return result;
    const item = Array.isArray(result.body) ? result.body[0] : result.body;
    if (!isRecord(item)) {
      return {
        ok: false,
        error: { kind: 'malformed', message: `no match ${fixtureExternalId} in the response` },
      };
    }
    const fixture = mapFixture(item, result.receivedAt);
    if (fixture === null) {
      return {
        ok: false,
        error: {
          kind: 'malformed',
          message: `match ${fixtureExternalId} is missing required fields`,
        },
      };
    }
    return { ok: true, item, fixture, receivedAt: result.receivedAt };
  }

  async getLive(query: LiveQuery): Promise<AdapterResult<NormalisedFixture[]>> {
    const ids = [...new Set(query.fixtureExternalIds)];
    if (ids.length === 0) {
      return { ok: true, data: [], requests: 0, fetchedAt: new Date().toISOString() };
    }
    if (ids.length > MAX_LIVE_IDS) {
      return this.unsupported(
        `${ids.length} fixtures is one request each; the adapter stops at ${MAX_LIVE_IDS}`,
      );
    }
    const data: NormalisedFixture[] = [];
    let requests = 0;
    let fetchedAt = '';
    for (const fixtureExternalId of ids) {
      const result = await this.matchById(fixtureExternalId);
      requests += 1;
      if (!result.ok) {
        // An unknown id is an empty array, not an error: skip it, keep the rest.
        if (result.error.kind === 'malformed') continue;
        return { ok: false, error: result.error, requests };
      }
      fetchedAt = result.receivedAt;
      data.push(result.fixture);
    }
    return { ok: true, data, requests, fetchedAt: fetchedAt || new Date().toISOString() };
  }

  async getLineup(fixtureExternalId: string): Promise<AdapterResult<NormalisedLineup>> {
    const result = await this.call(`/lineups/${fixtureExternalId}`);
    if (!result.ok) return { ok: false, error: result.error, requests: 1 };
    const lineup = mapLineup(result.body, fixtureExternalId);
    if (lineup === null) {
      return this.unsupported(`no lineup for match ${fixtureExternalId}`, 1);
    }
    return { ok: true, data: lineup, requests: 1, fetchedAt: result.receivedAt };
  }

  async getStandings(query: StandingsQuery): Promise<AdapterResult<NormalisedStanding[]>> {
    const season = seasonYear(query.seasonLabel);
    if (season === null)
      return this.unsupported(`cannot read a season from "${query.seasonLabel}"`);
    const result = await this.call('/standings', {
      leagueId: query.competitionExternalId,
      season: String(season),
    });
    if (!result.ok) return { ok: false, error: result.error, requests: 1 };
    // The standings body names the league only through its groups, so the
    // competition ref is the id we asked for plus the group name it echoes.
    const groups =
      isRecord(result.body) && Array.isArray(result.body.groups) ? result.body.groups : [];
    const first = isRecord(groups[0]) ? groups[0] : {};
    const name =
      typeof first.name === 'string' && first.name !== ''
        ? first.name
        : `league ${query.competitionExternalId}`;
    return {
      ok: true,
      data: mapStandings(
        result.body,
        { externalId: query.competitionExternalId, name },
        season,
        result.receivedAt,
      ),
      requests: 1,
      fetchedAt: result.receivedAt,
    };
  }

  async getFixtureDetail(
    fixtureExternalId: string,
  ): Promise<AdapterResult<NormalisedFixtureDetail>> {
    const result = await this.matchById(fixtureExternalId);
    if (!result.ok) return { ok: false, error: result.error, requests: 1 };
    const { item, fixture } = result;
    const homeId = fixture.home.externalId;
    const detail: NormalisedFixtureDetail = {
      fixture,
      incidents: mapIncidents(item.events, fixture.externalId, homeId),
      // Lineups live behind their own endpoint (`getLineup`); a detail does not
      // spend a second request on them.
      lineup: null,
      statistics: mapStatistics(item.statistics, homeId),
      periods: [],
    };
    return { ok: true, data: detail, requests: 1, fetchedAt: result.receivedAt };
  }
}

export const createHighlightlyAdapter: AdapterFactory = (transport, config) =>
  new HighlightlyAdapter(transport, config);
