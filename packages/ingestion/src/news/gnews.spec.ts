import { describe, expect, it } from 'vitest';
import type { Transport, TransportInit, TransportResponse } from '../adapters/_contract';
import {
  GNEWS_FOOTBALL_QUERY,
  articleUrlKey,
  gnewsUrl,
  parseGNews,
  readGNews,
  siteHost,
} from './gnews';

/**
 * The GNews reader (T-1367, D-185).
 *
 * The sample below is written for the spec in the shape GNews documents for
 * API v4 (`totalArticles`, `articles[]` with `title`, `description`,
 * `content`, `url`, `image`, `publishedAt`, `lang` and `source`). It is not a
 * recording of GNews' answer: no key existed when this was written, and a
 * recording is never invented. Its publishers and hosts are example names.
 */
const ANSWER = {
  totalArticles: 4,
  articles: [
    {
      id: 'a1',
      title: 'Testville win the derby &amp; go top',
      description: '<p>A late goal settled it.</p>',
      content: 'The whole truncated body, which must never be taken... [1234 chars]',
      url: 'https://www.publisher.example/football/derby?utm_source=gnews',
      image: 'https://cdn.publisher.example/derby.jpg',
      publishedAt: '2026-10-04T09:30:00Z',
      lang: 'en',
      source: { id: 's1', name: 'The Example Post', url: 'https://www.publisher.example' },
    },
    {
      title: 'No description, no source url',
      url: 'https://other.example/news/1',
      publishedAt: 'not a time',
      source: { name: 'Other Example' },
    },
    { title: '', url: 'https://blank.example/1', source: { name: 'Blank' } },
    { title: 'No publisher named', url: 'https://anon.example/1', source: {} },
    { title: 'Not a link', url: 'javascript:alert(1)', source: { name: 'Bad' } },
  ],
};

describe('parseGNews', () => {
  it('takes title, description, link, time and the original publisher -- never the content', () => {
    const parsed = parseGNews(JSON.stringify(ANSWER), 'en');
    expect(parsed).not.toBeNull();
    const [first, second] = parsed!.items;
    expect(first).toEqual({
      externalId: 'https://www.publisher.example/football/derby?utm_source=gnews',
      url: 'https://www.publisher.example/football/derby?utm_source=gnews',
      headline: 'Testville win the derby & go top',
      summary: 'A late goal settled it.',
      byline: null,
      publishedAt: '2026-10-04T09:30:00.000Z',
      language: 'en',
      categories: [],
      imageUrl: null,
      publisher: { name: 'The Example Post', homepage: 'https://www.publisher.example' },
    });
    expect(JSON.stringify(parsed)).not.toContain('truncated body');
    // Rule 3: a missing description and an unreadable time are null; the
    // publisher's site falls back to the link's own origin, its name never does.
    expect(second).toMatchObject({
      summary: null,
      publishedAt: null,
      language: 'en',
      publisher: { name: 'Other Example', homepage: 'https://other.example' },
    });
    expect(parsed!.skipped).toBe(3);
  });

  it('reads the photo only when asked (D-177)', () => {
    const parsed = parseGNews(ANSWER, 'en', { images: true });
    expect(parsed!.items[0]!.imageUrl).toBe('https://cdn.publisher.example/derby.jpg');
  });

  it('is null for a body that is not a GNews answer', () => {
    expect(parseGNews('<html>', 'en')).toBeNull();
    expect(parseGNews({ errors: ['nope'] }, 'en')).toBeNull();
  });
});

describe('readGNews over the transport', () => {
  const scripted = (status: number, body: unknown) => {
    const asked: { url: string; init?: TransportInit }[] = [];
    const transport: Transport = {
      request: async (url, init): Promise<TransportResponse> => {
        asked.push({ url, init });
        return { status, body, receivedAt: '2026-10-04T10:00:00.000Z' };
      },
    };
    return { transport, asked };
  };

  it('asks for English football, ten at most, newest first', async () => {
    const { transport, asked } = scripted(200, JSON.stringify(ANSWER));
    const result = await readGNews(transport, { apiKey: 'k-123', language: 'en', max: 50 });
    expect(result.ok).toBe(true);
    expect(result.requests).toBe(1);
    const url = new URL(asked[0]!.url);
    expect(url.origin + url.pathname).toBe('https://gnews.io/api/v4/search');
    expect(url.searchParams.get('q')).toBe(GNEWS_FOOTBALL_QUERY);
    expect(url.searchParams.get('lang')).toBe('en');
    expect(url.searchParams.get('max')).toBe('10');
    expect(url.searchParams.get('sortby')).toBe('publishedAt');
    expect(url.searchParams.get('apikey')).toBe('k-123');
  });

  it("names GNews' refusal without the key", async () => {
    const { transport } = scripted(403, { errors: ['You did not provide a valid API key.'] });
    const result = await readGNews(transport, { apiKey: 'secret-key', language: 'en' });
    expect(result).toMatchObject({
      ok: false,
      error: { kind: 'http', status: 403, message: expect.stringContaining('valid API key') },
    });
    expect(JSON.stringify(result)).not.toContain('secret-key');
  });

  it('a 429 is a quota error, a body that is not JSON is malformed', async () => {
    const quota = await readGNews(scripted(429, '').transport, { apiKey: 'k', language: 'en' });
    expect(quota).toMatchObject({ ok: false, error: { kind: 'quota' } });
    const odd = await readGNews(scripted(200, '<html>').transport, { apiKey: 'k', language: 'en' });
    expect(odd).toMatchObject({ ok: false, error: { kind: 'malformed' } });
  });

  it('builds the same URL it requests', () => {
    expect(gnewsUrl({ apiKey: 'k', language: 'en' })).toContain('in=title%2Cdescription');
  });
});

describe('articleUrlKey', () => {
  it('is the page: no scheme, www, trailing slash, fragment or tracking parameters', () => {
    const key = 'publisher.example/football/derby';
    expect(articleUrlKey('https://www.publisher.example/football/derby/')).toBe(key);
    expect(articleUrlKey('http://publisher.example/football/derby#top')).toBe(key);
    expect(
      articleUrlKey('https://www.Publisher.example/football/derby?at_medium=RSS&utm_source=x'),
    ).toBe(key);
  });

  it('keeps a query that names the page, in one order', () => {
    expect(articleUrlKey('https://a.example/story?id=7&page=2&utm_medium=feed')).toBe(
      articleUrlKey('https://a.example/story?page=2&id=7'),
    );
    expect(articleUrlKey('https://a.example/story?id=7')).not.toBe(
      articleUrlKey('https://a.example/story?id=8'),
    );
    expect(articleUrlKey('ftp://a.example/x')).toBeNull();
  });

  it('siteHost compares publishers by host', () => {
    expect(siteHost('https://www.Publisher.example/sport')).toBe('publisher.example');
    expect(siteHost('nope')).toBeNull();
  });
});
