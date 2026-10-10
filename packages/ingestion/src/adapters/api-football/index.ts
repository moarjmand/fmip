/**
 * API-Football adapter (T-021): api-sports.io v3, written against the free
 * plan (100 requests/day, 10/minute, seasons limited to the plan's window).
 *
 * The adapter never reaches the network itself: it asks the injected
 * `Transport`, so the contract check replays recordings and the bake-off
 * counts requests. Every call returns an `AdapterResult`; nothing throws.
 * Provider field names stay in `map.ts`.
 */

import type {
  EntityRef,
  NormalisedAbsence,
  NormalisedFixture,
  NormalisedFixtureDetail,
  NormalisedLineup,
  NormalisedLiveFixture,
  NormalisedSeasonCoverage,
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
  liveExtras,
  mapFixture,
  mapIncidents,
  mapLineup,
  mapPeriods,
  mapStandings,
  mapAvailability,
  mapPlayerStatistics,
  mapSeasonCoverage,
  mapSquad,
  mapStatistics,
  seasonYear,
} from './map';

export const API_FOOTBALL_BASE_URL = 'https://v3.football.api-sports.io';

export const API_FOOTBALL_MANIFEST: AdapterManifest = {
  provider: 'api_football',
  displayName: 'API-Football (api-sports.io)',
  criticalPath: true,
  licence: {
    kind: 'licensed_api',
    termsUrl: 'https://www.api-football.com/terms',
    // Bought on 2026-09-21 (D-076). The per-minute ceiling is not stated with
    // the plan, so it is not claimed here.
    tier: 'pro',
  },
  degradable: false,
  quota: { requestsPerDay: 7500, requestsPerMinute: null },
};

type Envelope = { response: unknown[]; errors: Record<string, string> };

/**
 * API-Football answers 200 to almost everything and reports problems in
 * `errors` (an object when there are any, an empty array when not). This
 * turns the envelope into either the `response` array or an `AdapterError`.
 */
function envelope(
  response: TransportResponse,
): { ok: true; data: Envelope } | { ok: false; error: AdapterError } {
  if (response.status !== 200) {
    return {
      ok: false,
      error: {
        kind: response.status === 429 ? 'quota' : 'http',
        message: `HTTP ${response.status}`,
        status: response.status,
      },
    };
  }
  const body = response.body;
  if (!isRecord(body) || !Array.isArray(body.response)) {
    return {
      ok: false,
      error: { kind: 'malformed', message: 'body is not an API-Football envelope' },
    };
  }
  const errors = isRecord(body.errors) ? body.errors : {};
  const keys = Object.keys(errors);
  if (keys.length > 0) {
    const message = keys.map((k) => `${k}: ${String(errors[k])}`).join('; ');
    const kind: AdapterError['kind'] =
      'requests' in errors || 'rateLimit' in errors
        ? 'quota'
        : 'plan' in errors || 'access' in errors
          ? 'unsupported'
          : 'token' in errors
            ? 'http'
            : 'malformed';
    return { ok: false, error: { kind, message, status: kind === 'http' ? 401 : undefined } };
  }
  return {
    ok: true,
    data: {
      response: body.response,
      errors: Object.fromEntries(keys.map((k) => [k, String(errors[k])])),
    },
  };
}

class ApiFootballAdapter implements ProviderAdapter {
  readonly manifest = API_FOOTBALL_MANIFEST;

  constructor(
    private readonly transport: Transport,
    private readonly config: AdapterConfig,
  ) {}

  private async get(path: string, params: Record<string, string>): Promise<TransportResponse> {
    const query = new URLSearchParams(params).toString();
    return this.transport.request(`${API_FOOTBALL_BASE_URL}${path}?${query}`, {
      method: 'GET',
      headers: this.config.apiKey === null ? {} : { 'x-apisports-key': this.config.apiKey },
    });
  }

  /** One request → envelope, with transport failures turned into a result. */
  private async call(
    path: string,
    params: Record<string, string>,
  ): Promise<
    { ok: true; data: Envelope; receivedAt: string } | { ok: false; error: AdapterError }
  > {
    let response: TransportResponse;
    try {
      response = await this.get(path, params);
    } catch (error: unknown) {
      return {
        ok: false,
        error: {
          kind: 'transport',
          message: error instanceof Error ? error.message : String(error),
        },
      };
    }
    const parsed = envelope(response);
    return parsed.ok ? { ...parsed, receivedAt: response.receivedAt } : parsed;
  }

  async listFixtures(query: FixtureQuery): Promise<AdapterResult<NormalisedFixture[]>> {
    const season = seasonYear(query.seasonLabel);
    if (season === null) {
      return {
        ok: false,
        error: { kind: 'unsupported', message: `cannot read a season from "${query.seasonLabel}"` },
        requests: 0,
      };
    }
    // One request either way; without the dates it is the whole season (T-505).
    const result = await this.call('/fixtures', {
      league: query.competitionExternalId,
      season: String(season),
      ...(query.wholeSeason === true ? {} : { from: query.from, to: query.to }),
    });
    if (!result.ok) return { ok: false, error: result.error, requests: 1 };
    const data = result.data.response
      .map((item) => mapFixture(item, result.receivedAt))
      .filter((f): f is NormalisedFixture => f !== null);
    return { ok: true, data, requests: 1, fetchedAt: result.receivedAt };
  }

  /**
   * The free plan refuses `/fixtures?ids=` ("Free plans do not have access to
   * the Ids parameter", recorded in the first attempt), so live state comes
   * from `live=all`: every match in play right now, one request, filtered to
   * the ids asked for. An empty id list means "everything live", which is how
   * the bake-off finds matches to follow. A fixture not in play is absent.
   */
  async getLive(query: LiveQuery): Promise<AdapterResult<NormalisedLiveFixture[]>> {
    const wanted = new Set(query.fixtureExternalIds);
    const result = await this.call('/fixtures', { live: 'all' });
    if (!result.ok) return { ok: false, error: result.error, requests: 1 };
    const data: NormalisedLiveFixture[] = [];
    for (const item of result.data.response) {
      const fixture = mapFixture(item, result.receivedAt);
      if (fixture !== null && (wanted.size === 0 || wanted.has(fixture.externalId))) {
        // The live list carries each match's events and its phase, so the
        // minute-by-minute job learns a scorer or a red card without a
        // detail request (T-830).
        data.push({ ...fixture, ...liveExtras(item, fixture) });
      }
    }
    return { ok: true, data, requests: 1, fetchedAt: result.receivedAt };
  }

  /**
   * `/fixtures?id=` carries the fixture, its lineups, events, statistics and
   * per-player statistics in one response, so lineup and detail cost one
   * request each and home/away are matched by team id, not array order.
   */
  private async fixtureById(
    fixtureExternalId: string,
  ): Promise<
    | { ok: true; item: Record<string, unknown>; fixture: NormalisedFixture; receivedAt: string }
    | { ok: false; error: AdapterError }
  > {
    const result = await this.call('/fixtures', { id: fixtureExternalId });
    if (!result.ok) return result;
    const item = result.data.response[0];
    if (!isRecord(item)) {
      return {
        ok: false,
        error: { kind: 'malformed', message: `no fixture ${fixtureExternalId} in response` },
      };
    }
    const fixture = mapFixture(item, result.receivedAt);
    if (fixture === null) {
      return {
        ok: false,
        error: {
          kind: 'malformed',
          message: `fixture ${fixtureExternalId} is missing required fields`,
        },
      };
    }
    return { ok: true, item, fixture, receivedAt: result.receivedAt };
  }

  async getLineup(fixtureExternalId: string): Promise<AdapterResult<NormalisedLineup>> {
    const result = await this.fixtureById(fixtureExternalId);
    if (!result.ok) return { ok: false, error: result.error, requests: 1 };
    const lineup = mapLineup(
      result.item.lineups,
      result.item.players,
      result.fixture.externalId,
      result.fixture.home.externalId,
      result.fixture.away.externalId,
    );
    if (lineup === null) {
      return {
        ok: false,
        error: {
          kind: 'unsupported',
          message: `no lineup for fixture ${fixtureExternalId}`,
          // The fixture came back; its line-up is not announced yet (T-1376).
          unpublished: true,
        },
        requests: 1,
      };
    }
    return { ok: true, data: lineup, requests: 1, fetchedAt: result.receivedAt };
  }

  async getStandings(query: StandingsQuery): Promise<AdapterResult<NormalisedStanding[]>> {
    const season = seasonYear(query.seasonLabel);
    if (season === null) {
      return {
        ok: false,
        error: { kind: 'unsupported', message: `cannot read a season from "${query.seasonLabel}"` },
        requests: 0,
      };
    }
    const result = await this.call('/standings', {
      league: query.competitionExternalId,
      season: String(season),
    });
    if (!result.ok) return { ok: false, error: result.error, requests: 1 };
    return {
      ok: true,
      data: mapStandings(result.data.response, result.receivedAt),
      requests: 1,
      fetchedAt: result.receivedAt,
    };
  }

  async getFixtureDetail(
    fixtureExternalId: string,
  ): Promise<AdapterResult<NormalisedFixtureDetail>> {
    const result = await this.fixtureById(fixtureExternalId);
    if (!result.ok) return { ok: false, error: result.error, requests: 1 };
    const { item, fixture } = result;
    const homeId = fixture.home.externalId;
    const detail: NormalisedFixtureDetail = {
      fixture,
      incidents: mapIncidents(item.events, fixture.externalId, homeId),
      lineup: mapLineup(
        item.lineups,
        item.players,
        fixture.externalId,
        homeId,
        fixture.away.externalId,
      ),
      statistics: mapStatistics(item.statistics, homeId),
      playerStatistics: mapPlayerStatistics(item.players, homeId, fixture.away.externalId),
      periods: mapPeriods(isRecord(item.fixture) ? item.fixture.periods : null),
    };
    return { ok: true, data: detail, requests: 1, fetchedAt: result.receivedAt };
  }

  async getAvailability(fixtureExternalId: string): Promise<AdapterResult<NormalisedAbsence[]>> {
    const result = await this.call('/injuries', { fixture: fixtureExternalId });
    if (!result.ok) return { ok: false, error: result.error, requests: 1 };
    return {
      ok: true,
      data: mapAvailability(result.data.response, fixtureExternalId),
      requests: 1,
      fetchedAt: result.receivedAt,
    };
  }

  /**
   * `/leagues?id=&season=`: what the provider covers for this league's season,
   * one request (T-1364). Only whether it reports absences is read.
   */
  async getSeasonCoverage(query: StandingsQuery): Promise<AdapterResult<NormalisedSeasonCoverage>> {
    const season = seasonYear(query.seasonLabel);
    if (season === null) {
      return {
        ok: false,
        error: { kind: 'unsupported', message: `cannot read a season from "${query.seasonLabel}"` },
        requests: 0,
      };
    }
    const result = await this.call('/leagues', {
      id: query.competitionExternalId,
      season: String(season),
    });
    if (!result.ok) return { ok: false, error: result.error, requests: 1 };
    return {
      ok: true,
      data: mapSeasonCoverage(result.data.response, query.competitionExternalId, season),
      requests: 1,
      fetchedAt: result.receivedAt,
    };
  }

  /** `/players/squads?team=`: the club's current squad, one request (T-1324). */
  async getSquad(teamExternalId: string): Promise<AdapterResult<EntityRef[]>> {
    const result = await this.call('/players/squads', { team: teamExternalId });
    if (!result.ok) return { ok: false, error: result.error, requests: 1 };
    return {
      ok: true,
      data: mapSquad(result.data.response, teamExternalId),
      requests: 1,
      fetchedAt: result.receivedAt,
    };
  }
}

export const createApiFootballAdapter: AdapterFactory = (transport, config) =>
  new ApiFootballAdapter(transport, config);
