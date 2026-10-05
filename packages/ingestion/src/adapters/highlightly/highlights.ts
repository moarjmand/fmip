/**
 * Highlightly's highlights (T-1366, D-184): `GET /highlights` and
 * `GET /highlights/geo-restrictions/{id}` on the same host and headers as the
 * match adapter. Field names below are Highlightly's and stay in this
 * directory; what leaves it is `NormalisedHighlight` and `HighlightGeo`.
 *
 * From the provider's documentation and OpenAPI file (read 2026-10-04):
 *   - a list answers `{ data, pagination: { totalCount, offset, limit } }`,
 *     at most 40 a page, and needs at least one "primary" parameter (a date,
 *     a league, a match ...);
 *   - each item has `type` VERIFIED or UNVERIFIED -- a verified clip is the
 *     rights holder's own upload -- `url` (the original), `embedUrl`,
 *     `channel` (who published it), `source` (youtube, twitter ...),
 *     `category` (`match-highlights`, `goal-clip`, `press-conference` ...) and
 *     the `match` with its teams, league and date;
 *   - the geo call answers `state` ("No restricitons applied" -- sic --,
 *     "Allowed countries restriction", "Blocked countries restriction",
 *     "Unknown restrictions"), `allowedCountries` and `blockedCountries` as
 *     ISO 3166 alpha-2 codes, and `embeddable`. Pro plan and above.
 *
 * Only VERIFIED clips leave this file, and only full-match highlights (or a
 * clip that names no category): a goal clip or a press conference is not
 * "the match's highlights". The embed address is read and dropped -- D-069
 * and D-184 send a viewer to the original, never to a player on our page.
 */

import type { AdapterError, AdapterResult, Transport, TransportResponse } from '../_contract';
import { HIGHLIGHTLY_BASE_URL, HIGHLIGHTLY_HOST } from './index';
import { isRecord } from './map';

/** The provider's page size ceiling. */
export const HIGHLIGHTS_PAGE_SIZE = 40;

/** One side or the competition of the match a clip belongs to, by the provider's id. */
export interface HighlightEntityRef {
  externalId: string;
  name: string;
}

/** A verified full-match highlight, provider-neutral. */
export interface NormalisedHighlight {
  title: string;
  /** The original, always https: where a viewer is sent. */
  url: string;
  /** Who published it ("LaLiga", "Sky Sports"), as the provider names the channel; null when unnamed. */
  publisher: string | null;
  /** The provider's id for the clip: what the geo call is asked about. Never stored (rule 1). */
  externalId: string;
  /** True when the provider filed it as full-match highlights; false when it named no category. */
  matchHighlights: boolean;
  match: {
    externalId: string;
    kickoffAt: string;
    competition: HighlightEntityRef | null;
    home: HighlightEntityRef;
    away: HighlightEntityRef;
  };
}

/** Why an item on a page was not taken. */
export type HighlightSkip = 'unverified' | 'not_match_highlights' | 'malformed';

export interface HighlightsPage {
  highlights: NormalisedHighlight[];
  skipped: Record<HighlightSkip, number>;
}

/**
 * Where a clip may be watched. `known`: offered in a territory when it is in
 * `allowed` (an empty list allows every territory) and not in `blocked`.
 * `unknown`: the provider cannot say, and nothing is offered anywhere.
 */
export type HighlightGeo =
  { state: 'known'; allowed: string[]; blocked: string[] } | { state: 'unknown' };

const str = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
const idOf = (value: unknown): string | null =>
  typeof value === 'number' && Number.isInteger(value)
    ? String(value)
    : typeof value === 'string' && /^\d+$/.test(value)
      ? value
      : null;

function entity(value: unknown): HighlightEntityRef | null {
  if (!isRecord(value)) return null;
  const externalId = idOf(value.id);
  const name = str(value.name);
  return externalId === null || name === null ? null : { externalId, name };
}

function httpsUrl(value: unknown): string | null {
  const text = str(value);
  if (text === null) return null;
  try {
    return new URL(text).protocol === 'https:' ? text : null;
  } catch {
    return null;
  }
}

/** One list item, or why it was not taken. */
export function mapHighlight(item: unknown): NormalisedHighlight | HighlightSkip {
  if (!isRecord(item)) return 'malformed';
  if (item.type !== 'VERIFIED') return item.type === 'UNVERIFIED' ? 'unverified' : 'malformed';
  const category = str(item.category);
  if (category !== null && category !== 'match-highlights') return 'not_match_highlights';
  const externalId = idOf(item.id);
  const url = httpsUrl(item.url);
  const match = isRecord(item.match) ? item.match : null;
  const matchId = match === null ? null : idOf(match.id);
  const kickoff = match === null ? null : str(match.date);
  const home = match === null ? null : entity(match.homeTeam);
  const away = match === null ? null : entity(match.awayTeam);
  if (
    externalId === null ||
    url === null ||
    matchId === null ||
    kickoff === null ||
    Number.isNaN(Date.parse(kickoff)) ||
    home === null ||
    away === null
  ) {
    return 'malformed';
  }
  return {
    title: str(item.title) ?? '',
    url,
    publisher: str(item.channel),
    externalId,
    matchHighlights: category === 'match-highlights',
    match: {
      externalId: matchId,
      kickoffAt: new Date(Date.parse(kickoff)).toISOString(),
      competition: entity(match?.league),
      home,
      away,
    },
  };
}

/** A list body: the verified full-match highlights on it and what was left, by reason. */
export function mapHighlightsPage(body: unknown): HighlightsPage | null {
  if (!isRecord(body) || !Array.isArray(body.data)) return null;
  const page: HighlightsPage = {
    highlights: [],
    skipped: { unverified: 0, not_match_highlights: 0, malformed: 0 },
  };
  for (const item of body.data) {
    const mapped = mapHighlight(item);
    if (typeof mapped === 'string') page.skipped[mapped] += 1;
    else page.highlights.push(mapped);
  }
  return page;
}

const COUNTRY = /^[A-Z]{2}$/;

function countries(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const codes = value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim().toUpperCase())
    // The United Kingdom's ISO code is GB; "UK" is reserved, not assigned.
    .map((code) => (code === 'UK' ? 'GB' : code));
  return codes.every((code) => COUNTRY.test(code)) && codes.length === value.length
    ? [...new Set(codes)].sort()
    : null;
}

/**
 * The geo call's body. A state that is not one of the documented three, a
 * list that is not codes, or an allow rule that allows nobody, is `unknown`
 * -- never "everywhere".
 */
export function mapGeo(body: unknown): HighlightGeo {
  if (!isRecord(body)) return { state: 'unknown' };
  const state = typeof body.state === 'string' ? body.state.trim().toLowerCase() : '';
  const allowed = body.allowedCountries === undefined ? [] : countries(body.allowedCountries);
  const blocked = body.blockedCountries === undefined ? [] : countries(body.blockedCountries);
  if (allowed === null || blocked === null) return { state: 'unknown' };
  // The provider spells it "restricitons"; read the start of the phrase only.
  if (state.startsWith('no restri')) return { state: 'known', allowed, blocked };
  if (state.startsWith('allowed countries')) {
    return allowed.length === 0 ? { state: 'unknown' } : { state: 'known', allowed, blocked };
  }
  if (state.startsWith('blocked countries')) return { state: 'known', allowed, blocked };
  return { state: 'unknown' };
}

function failure(response: TransportResponse): AdapterError {
  const body = isRecord(response.body) ? response.body : {};
  const text = str(body.message) ?? str(body.error) ?? `HTTP ${response.status}`;
  const kind: AdapterError['kind'] =
    response.status === 429 ? 'quota' : response.status === 403 ? 'unsupported' : 'http';
  return { kind, message: text, status: response.status };
}

export interface HighlightsQuery {
  /** YYYY-MM-DD, read by the provider in UTC. */
  date: string;
  /** The provider's league id; the list is asked one league at a time. */
  leagueExternalId: string;
  /** At most this many pages of 40 (default 5). */
  maxPages?: number;
}

export interface HighlightlyHighlights {
  /** Every verified full-match highlight of one league on one day, page by page. */
  list(query: HighlightsQuery): Promise<AdapterResult<HighlightsPage>>;
  /** Where one clip may be watched. */
  geo(externalId: string): Promise<AdapterResult<HighlightGeo>>;
}

/** The highlights client over the injected transport (the budget is the caller's). */
export function createHighlightlyHighlights(
  transport: Transport,
  apiKey: string,
): HighlightlyHighlights {
  async function get(
    path: string,
    params: Record<string, string> = {},
  ): Promise<{ ok: true; body: unknown; receivedAt: string } | { ok: false; error: AdapterError }> {
    const query = new URLSearchParams(params).toString();
    const url = `${HIGHLIGHTLY_BASE_URL}${path}${query === '' ? '' : `?${query}`}`;
    let response: TransportResponse;
    try {
      response = await transport.request(url, {
        method: 'GET',
        headers: { 'x-rapidapi-host': HIGHLIGHTLY_HOST, 'x-rapidapi-key': apiKey },
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

  return {
    async list(query) {
      const maxPages = query.maxPages ?? 5;
      const page: HighlightsPage = {
        highlights: [],
        skipped: { unverified: 0, not_match_highlights: 0, malformed: 0 },
      };
      let requests = 0;
      let fetchedAt = '';
      for (let offset = 0; requests < maxPages; offset += HIGHLIGHTS_PAGE_SIZE) {
        const result = await get('/highlights', {
          leagueId: query.leagueExternalId,
          date: query.date,
          timezone: 'Etc/UTC',
          limit: String(HIGHLIGHTS_PAGE_SIZE),
          offset: String(offset),
        });
        requests += 1;
        if (!result.ok) return { ok: false, error: result.error, requests };
        fetchedAt = result.receivedAt;
        const mapped = mapHighlightsPage(result.body);
        if (mapped === null) {
          return {
            ok: false,
            error: { kind: 'malformed', message: `no data array for ${query.date}` },
            requests,
          };
        }
        page.highlights.push(...mapped.highlights);
        for (const reason of Object.keys(page.skipped) as HighlightSkip[]) {
          page.skipped[reason] += mapped.skipped[reason];
        }
        const body = result.body as Record<string, unknown>;
        const pagination = isRecord(body.pagination) ? body.pagination : {};
        const total = typeof pagination.totalCount === 'number' ? pagination.totalCount : 0;
        const items = Array.isArray(body.data) ? body.data.length : 0;
        if (items < HIGHLIGHTS_PAGE_SIZE || offset + items >= total) break;
      }
      return { ok: true, data: page, requests, fetchedAt };
    },

    async geo(externalId) {
      if (!/^\d+$/.test(externalId)) {
        return {
          ok: false,
          error: { kind: 'unsupported', message: `not a highlight id: ${externalId}` },
          requests: 0,
        };
      }
      const result = await get(`/highlights/geo-restrictions/${externalId}`);
      if (!result.ok) return { ok: false, error: result.error, requests: 1 };
      return { ok: true, data: mapGeo(result.body), requests: 1, fetchedAt: result.receivedAt };
    },
  };
}
