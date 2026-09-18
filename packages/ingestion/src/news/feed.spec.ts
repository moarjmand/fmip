import { describe, expect, it } from 'vitest';
import type { Transport, TransportResponse } from '../adapters/_contract';
import { decodeEntities, firstElement, isoDate, parseFeed, readFeed, textOf } from './feed';

/**
 * The feed reader (T-142) against the two formats publishers actually use.
 *
 * These are format samples written for the spec -- RSS 2.0 and Atom as their
 * specifications describe them -- not recordings of a publisher's feed. The
 * `_fixtures` rule that recordings are never invented is about a provider's
 * API, whose behaviour only a recording can attest; a syndication format is a
 * published standard, and an example of it is a specification of the reader,
 * not a claim about anybody's feed.
 */

const RSS = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:content="http://purl.org/rss/1.0/modules/content/">
  <channel>
    <title>Example Football News</title>
    <link>https://news.example.test/</link>
    <language>en-GB</language>
    <item>
      <title>Testville win the derby &amp; go top</title>
      <link>https://news.example.test/derby</link>
      <guid isPermaLink="false">derby-2025-01</guid>
      <pubDate>Sun, 05 Jan 2025 16:28:00 GMT</pubDate>
      <dc:creator>A. Reporter</dc:creator>
      <description><![CDATA[<p>A late goal settled it &mdash; <b>2&ndash;1</b>.</p>]]></description>
      <content:encoded><![CDATA[<p>The whole article, which must never be taken.</p>]]></content:encoded>
    </item>
    <item>
      <title>Injury update</title>
      <link>https://news.example.test/injury</link>
      <pubDate>not a date</pubDate>
    </item>
    <item>
      <title></title>
      <link>https://news.example.test/blank</link>
    </item>
    <item>
      <title>No link at all</title>
    </item>
  </channel>
</rss>`;

const ATOM = `<?xml version="1.0" encoding="utf-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="es">
  <title>Noticias de ejemplo</title>
  <entry>
    <title>El Testville gana el derbi</title>
    <link rel="self" href="https://news.example.test/atom/derby.xml"/>
    <link rel="alternate" href="https://news.example.test/es/derbi"/>
    <id>urn:example:derbi-2025</id>
    <published>2025-01-05T16:28:00Z</published>
    <updated>2025-01-05T18:00:00Z</updated>
    <author><name>Una Periodista</name></author>
    <summary type="html">&lt;p&gt;Un gol tardío lo decidió.&lt;/p&gt;</summary>
  </entry>
  <entry xml:lang="ca">
    <title>Sense resum</title>
    <link href="https://news.example.test/ca/sense-resum"/>
    <updated>2025-01-06T09:00:00Z</updated>
  </entry>
</feed>`;

describe('parseFeed: RSS 2.0', () => {
  const feed = parseFeed(RSS);
  it('reads the channel and takes only what D-061 permits from each item', () => {
    expect('items' in feed).toBe(true);
    if (!('items' in feed)) return;
    expect(feed.kind).toBe('rss');
    expect(feed.title).toBe('Example Football News');
    expect(feed.language).toBe('en-GB');
    expect(feed.items[0]).toEqual({
      externalId: 'derby-2025-01',
      url: 'https://news.example.test/derby',
      headline: 'Testville win the derby & go top',
      summary: 'A late goal settled it — 2–1.',
      byline: 'A. Reporter',
      publishedAt: '2025-01-05T16:28:00.000Z',
      language: 'en-GB',
    });
    // The item carries a full body in content:encoded; nothing in the result
    // can hold it, and nothing does.
    expect(JSON.stringify(feed.items)).not.toContain('whole article');
  });

  it('gives null for what an item does not carry, never a guess', () => {
    if (!('items' in feed)) return;
    const [, injury] = feed.items;
    expect(injury).toEqual({
      externalId: 'https://news.example.test/injury',
      url: 'https://news.example.test/injury',
      headline: 'Injury update',
      summary: null,
      byline: null,
      publishedAt: null,
      language: 'en-GB',
    });
  });

  it('skips an item with no headline or no link, and counts it', () => {
    if (!('items' in feed)) return;
    expect(feed.items).toHaveLength(2);
    expect(feed.skipped).toBe(2);
  });
});

describe('parseFeed: Atom', () => {
  const feed = parseFeed(ATOM);
  it('prefers the alternate link, reads the entry in its own language, and decodes the summary', () => {
    if (!('items' in feed)) return;
    expect(feed.kind).toBe('atom');
    expect(feed.language).toBe('es');
    expect(feed.items[0]).toEqual({
      externalId: 'urn:example:derbi-2025',
      url: 'https://news.example.test/es/derbi',
      headline: 'El Testville gana el derbi',
      summary: 'Un gol tardío lo decidió.',
      byline: 'Una Periodista',
      publishedAt: '2025-01-05T16:28:00.000Z',
      language: 'es',
    });
    expect(feed.items[1]).toMatchObject({
      url: 'https://news.example.test/ca/sense-resum',
      summary: null,
      byline: null,
      publishedAt: '2025-01-06T09:00:00.000Z',
      language: 'ca',
    });
  });
});

describe('what is not a feed', () => {
  it('says so, rather than reading nothing as an empty feed', () => {
    expect(parseFeed('')).toEqual({ kind: 'malformed', message: 'not XML' });
    expect(parseFeed('{"items":[]}')).toEqual({ kind: 'malformed', message: 'not XML' });
    expect(parseFeed('<html><body>Not Found</body></html>')).toMatchObject({ kind: 'malformed' });
  });

  it('treats a feed with no items as a feed with no items', () => {
    const feed = parseFeed('<rss version="2.0"><channel><title>Quiet</title></channel></rss>');
    expect(feed).toMatchObject({ kind: 'rss', title: 'Quiet', items: [], skipped: 0 });
  });
});

describe('the small parts', () => {
  it('decodes entities and character references', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#8212; &#x2014; &unknown;')).toBe(
      'a & b <c> — — &unknown;',
    );
  });
  it('strips tags and CDATA and collapses whitespace', () => {
    expect(textOf('<![CDATA[  <b>Bold</b>\n  text ]]>')).toBe('Bold text');
    expect(textOf('   ')).toBeNull();
    expect(textOf(null)).toBeNull();
  });
  it('finds a namespaced element by its local name', () => {
    expect(firstElement('<a><dc:creator>Me</dc:creator></a>', 'creator')).toBe('Me');
    expect(firstElement('<a><title>x</title></a>', 'link')).toBeNull();
  });
  it('never turns a bad date into now', () => {
    expect(isoDate('yesterday-ish')).toBeNull();
    expect(isoDate('2025-01-05T16:28:00Z')).toBe('2025-01-05T16:28:00.000Z');
  });
});

describe('readFeed over the transport', () => {
  const answering = (status: number, body: unknown): Transport => ({
    request: async (): Promise<TransportResponse> => ({
      status,
      body,
      receivedAt: '2025-01-05T17:00:00.000Z',
    }),
  });

  it('parses a 200 text body and reports one request', async () => {
    const result = await readFeed(answering(200, RSS), 'https://news.example.test/feed');
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items).toHaveLength(2);
    expect(result.requests).toBe(1);
    expect(result.fetchedAt).toBe('2025-01-05T17:00:00.000Z');
  });

  it('reports a JSON answer as malformed, not as an empty feed', async () => {
    const result = await readFeed(answering(200, { items: [] }), 'https://news.example.test/feed');
    expect(result).toMatchObject({ ok: false, error: { kind: 'malformed' }, requests: 1 });
  });

  it('names the refusal: quota for 429, transport for a 5xx, http for the rest', async () => {
    for (const [status, kind] of [
      [429, 'quota'],
      [503, 'transport'],
      [404, 'http'],
    ] as const) {
      const result = await readFeed(answering(status, ''), 'https://news.example.test/feed');
      expect(result).toMatchObject({ ok: false, error: { kind, status } });
    }
  });
});
