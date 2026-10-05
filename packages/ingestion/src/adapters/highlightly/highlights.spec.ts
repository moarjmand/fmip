import { describe, expect, it } from 'vitest';
import type { Transport, TransportInit, TransportResponse } from '../_contract';
import { createHighlightlyHighlights, mapGeo, mapHighlight, mapHighlightsPage } from './highlights';

// Format samples written from the provider's documentation and OpenAPI file
// (2026-10-04) for this spec: a specification of the reader, not a recording.
function item(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 41001,
    type: 'VERIFIED',
    imgUrl: 'https://img.test/41001.jpg',
    title: 'Real Madrid 2-1 Sevilla | Highlights',
    description: 'All the goals',
    url: 'https://www.youtube.com/watch?v=abc',
    embedUrl: 'https://www.youtube.com/embed/abc',
    channel: 'LaLiga',
    source: 'youtube',
    category: 'match-highlights',
    match: {
      id: 9001,
      round: 'Regular Season - 7',
      date: '2026-10-03T19:00:00.000Z',
      country: { code: 'ES', name: 'Spain', logo: 'https://img.test/es.png' },
      homeTeam: { id: 501, name: 'Real Madrid', logo: 'https://img.test/501.png' },
      awayTeam: { id: 502, name: 'Sevilla', logo: 'https://img.test/502.png' },
      league: { id: 119924, season: 2026, name: 'La Liga' },
      state: { description: 'Finished', score: { current: '2 - 1' } },
    },
    ...over,
  };
}

class Scripted implements Transport {
  readonly urls: string[] = [];
  readonly headers: Record<string, string>[] = [];
  constructor(private readonly answers: TransportResponse[]) {}
  request(url: string, init?: TransportInit): Promise<TransportResponse> {
    this.urls.push(url);
    this.headers.push(init?.headers ?? {});
    const next = this.answers.shift();
    if (next === undefined) throw new Error('no scripted answer left');
    return Promise.resolve(next);
  }
}

const ok = (body: unknown): TransportResponse => ({
  status: 200,
  body,
  receivedAt: '2026-10-04T10:00:00.000Z',
});

describe('a highlight item', () => {
  it('keeps a verified full-match highlight with its publisher and match, and drops the embed', () => {
    const mapped = mapHighlight(item());
    expect(mapped).toEqual({
      title: 'Real Madrid 2-1 Sevilla | Highlights',
      url: 'https://www.youtube.com/watch?v=abc',
      publisher: 'LaLiga',
      externalId: '41001',
      matchHighlights: true,
      match: {
        externalId: '9001',
        kickoffAt: '2026-10-03T19:00:00.000Z',
        competition: { externalId: '119924', name: 'La Liga' },
        home: { externalId: '501', name: 'Real Madrid' },
        away: { externalId: '502', name: 'Sevilla' },
      },
    });
    expect(JSON.stringify(mapped)).not.toContain('embed');
  });

  it('refuses an unverified clip, a goal clip and a press conference', () => {
    expect(mapHighlight(item({ type: 'UNVERIFIED' }))).toBe('unverified');
    expect(mapHighlight(item({ category: 'goal-clip' }))).toBe('not_match_highlights');
    expect(mapHighlight(item({ category: 'press-conference' }))).toBe('not_match_highlights');
  });

  it('takes a verified clip that names no category, marked as such', () => {
    const mapped = mapHighlight(item({ category: undefined }));
    expect(typeof mapped === 'object' && mapped.matchHighlights).toBe(false);
  });

  it('refuses what it cannot send a viewer to or place', () => {
    expect(mapHighlight(item({ url: 'http://insecure.test/v' }))).toBe('malformed');
    expect(mapHighlight(item({ url: 'not a url' }))).toBe('malformed');
    expect(mapHighlight(item({ type: 'SOMETHING' }))).toBe('malformed');
    expect(mapHighlight(item({ match: { id: 9001, date: 'tomorrow' } }))).toBe('malformed');
    expect(mapHighlight('nope')).toBe('malformed');
  });

  it('reads a channel it is not given as unnamed, never guessed', () => {
    const mapped = mapHighlight(item({ channel: '' }));
    expect(typeof mapped === 'object' && mapped.publisher).toBeNull();
  });

  it('counts what a page left, by reason', () => {
    const page = mapHighlightsPage({
      data: [item(), item({ type: 'UNVERIFIED' }), item({ category: 'goal-clip' }), 7],
    });
    expect(page?.highlights).toHaveLength(1);
    expect(page?.skipped).toEqual({ unverified: 1, not_match_highlights: 1, malformed: 1 });
    expect(mapHighlightsPage({ message: 'error' })).toBeNull();
  });
});

describe('the geo answer', () => {
  it('reads the provider’s own spelling of "no restrictions" as everywhere', () => {
    expect(
      mapGeo({
        state: 'No restricitons applied',
        allowedCountries: [],
        blockedCountries: [],
        embeddable: true,
      }),
    ).toEqual({ state: 'known', allowed: [], blocked: [] });
  });

  it('reads an allow list and a block list as codes, GB for UK', () => {
    expect(
      mapGeo({ state: 'Allowed countries restriction', allowedCountries: ['it', 'UK'] }),
    ).toEqual({ state: 'known', allowed: ['GB', 'IT'], blocked: [] });
    expect(
      mapGeo({ state: 'Blocked countries restriction', blockedCountries: ['IR', 'US'] }),
    ).toEqual({ state: 'known', allowed: [], blocked: ['IR', 'US'] });
  });

  it('is unknown rather than everywhere when it cannot be read', () => {
    expect(mapGeo({ state: 'Unknown restrictions' })).toEqual({ state: 'unknown' });
    expect(mapGeo({ state: 'Allowed countries restriction', allowedCountries: [] })).toEqual({
      state: 'unknown',
    });
    expect(mapGeo({ state: 'Blocked countries restriction', blockedCountries: ['Iran'] })).toEqual({
      state: 'unknown',
    });
    expect(mapGeo({ state: 'Something new' })).toEqual({ state: 'unknown' });
    expect(mapGeo(null)).toEqual({ state: 'unknown' });
  });
});

describe('the client', () => {
  it('asks one league on one day in UTC, with the key in a header, page by page', async () => {
    const full = Array.from({ length: 40 }, (_, i) => item({ id: 1000 + i, type: 'UNVERIFIED' }));
    const transport = new Scripted([
      ok({ data: full, pagination: { totalCount: 41, offset: 0, limit: 40 } }),
      ok({ data: [item()], pagination: { totalCount: 41, offset: 40, limit: 40 } }),
    ]);
    const client = createHighlightlyHighlights(transport, 'secret-key');
    const result = await client.list({ date: '2026-10-03', leagueExternalId: '119924' });
    expect(result.ok && result.data.highlights.map((h) => h.externalId)).toEqual(['41001']);
    expect(result.requests).toBe(2);
    expect(transport.urls[0]).toBe(
      'https://sports.highlightly.net/football/highlights?leagueId=119924&date=2026-10-03&timezone=Etc%2FUTC&limit=40&offset=0',
    );
    expect(transport.urls[1]).toContain('offset=40');
    expect(transport.urls.join(' ')).not.toContain('secret-key');
    expect(transport.headers[0]).toEqual({
      'x-rapidapi-host': 'sports.highlightly.net',
      'x-rapidapi-key': 'secret-key',
    });
  });

  it('stops at the page ceiling', async () => {
    const full = Array.from({ length: 40 }, (_, i) => item({ id: 2000 + i }));
    const transport = new Scripted([
      ok({ data: full, pagination: { totalCount: 400, offset: 0, limit: 40 } }),
      ok({ data: full, pagination: { totalCount: 400, offset: 40, limit: 40 } }),
    ]);
    const result = await createHighlightlyHighlights(transport, 'k').list({
      date: '2026-10-03',
      leagueExternalId: '1',
      maxPages: 2,
    });
    expect(result.requests).toBe(2);
    expect(result.ok && result.data.highlights).toHaveLength(80);
  });

  it('reports a refusal as a quota or an unsupported plan, with the requests spent', async () => {
    const quota = await createHighlightlyHighlights(
      new Scripted([{ status: 429, body: { message: 'spent' }, receivedAt: 'x' }]),
      'k',
    ).list({ date: '2026-10-03', leagueExternalId: '1' });
    expect(quota).toEqual({
      ok: false,
      error: { kind: 'quota', message: 'spent', status: 429 },
      requests: 1,
    });
    const plan = await createHighlightlyHighlights(
      new Scripted([{ status: 403, body: {}, receivedAt: 'x' }]),
      'k',
    ).geo('41001');
    expect(plan.ok).toBe(false);
    expect(!plan.ok && plan.error.kind).toBe('unsupported');
  });

  it('asks the geo call by the clip’s id and never for something that is not one', async () => {
    const transport = new Scripted([
      ok({
        state: 'Blocked countries restriction',
        allowedCountries: [],
        blockedCountries: ['IR'],
      }),
    ]);
    const client = createHighlightlyHighlights(transport, 'k');
    const geo = await client.geo('41001');
    expect(geo.ok && geo.data).toEqual({ state: 'known', allowed: [], blocked: ['IR'] });
    expect(transport.urls).toEqual([
      'https://sports.highlightly.net/football/highlights/geo-restrictions/41001',
    ]);
    expect((await client.geo('../matches')).requests).toBe(0);
  });
});
