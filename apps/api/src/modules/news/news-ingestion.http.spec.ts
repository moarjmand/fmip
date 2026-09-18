import { Test } from '@nestjs/testing';
import type { Transport, TransportResponse } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { NEWS_TRANSPORT } from './internal/news-transport';
import { NewsIngestionService } from './news-ingestion.service';
import { NewsModule } from './news.module';

/**
 * The news job against the real schema (T-142, D-061), with every response
 * scripted: what a feed says is the input, what the tables hold is the output.
 *
 * The properties that matter, each its own test: running twice over the same
 * feed writes nothing the second time; a changed headline is a new version and
 * the old one stays; a headline-only source never stores the summary the feed
 * carried; a publisher's robots.txt is obeyed; a feed that answers 404 or with
 * something that is not a feed is a partial run naming the reason, not an
 * error; a dropped source is not read at all.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

const feedXml = (
  headline: string,
  summary = 'What the publisher wrote.',
): string => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Scripted</title><language>en</language>
<item><title>${headline}</title><link>https://scripted.test/one</link><guid>one-${RUN}</guid>
<pubDate>Sun, 05 Jan 2025 16:28:00 GMT</pubDate><description>${summary}</description></item>
<item><title>Second ${RUN}</title><link>https://scripted.test/two</link><guid>two-${RUN}</guid></item>
</channel></rss>`;

/** A transport that answers from a table of URL -> response, and remembers what was asked. */
class ScriptedTransport implements Transport {
  readonly asked: string[] = [];
  constructor(readonly answers: Map<string, { status: number; body: string }>) {}
  async request(url: string): Promise<TransportResponse> {
    this.asked.push(url);
    const hit = this.answers.get(url) ?? { status: 404, body: 'not here' };
    return { status: hit.status, body: hit.body, receivedAt: new Date().toISOString() };
  }
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('news ingestion', () => {
  let pool: Pool;
  let service: NewsIngestionService;
  let transport: ScriptedTransport;
  let app: { close(): Promise<void> };
  const sources: string[] = [];

  const source = async (
    rights: 'headline' | 'summary',
    feedUrl: string,
    dropped = false,
  ): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language, dropped_at, dropped_reason)
       VALUES ($1, 'https://scripted.test', $2, 'rss', $3, 'en', $4, $5) RETURNING id`,
      [
        `Scripted ${rights} ${feedUrl.slice(-6)} ${RUN}`,
        feedUrl,
        rights,
        dropped ? new Date() : null,
        dropped ? 'asked to be dropped' : null,
      ],
    );
    sources.push(rows[0]!.id);
    return rows[0]!.id;
  };

  const versions = (sourceId: string) =>
    pool.query<{
      external_id: string;
      version_number: number;
      headline: string;
      summary: string | null;
    }>(
      `SELECT a.external_id, v.version_number, v.headline, v.summary
         FROM article a JOIN article_version v ON v.article_id = a.id
        WHERE a.source_id = $1
        ORDER BY a.external_id, v.version_number`,
      [sourceId],
    );

  const fetches = (sourceId: string) =>
    pool.query<{ status: string; items_seen: number; items_written: number; error: string | null }>(
      `SELECT status, items_seen, items_written, error FROM news_fetch WHERE source_id = $1 ORDER BY started_at`,
      [sourceId],
    );

  beforeAll(async () => {
    transport = new ScriptedTransport(new Map());
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, NewsModule] })
      .overrideProvider(NEWS_TRANSPORT)
      .useValue(transport)
      .compile();
    app = await moduleRef.createNestApplication().init();
    service = moduleRef.get(NewsIngestionService);
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (sources.length > 0) {
      await pool.query(`DELETE FROM news_source WHERE id = ANY($1::uuid[])`, [sources]);
    }
    await pool.query(
      `DELETE FROM story WHERE NOT EXISTS (SELECT 1 FROM article a WHERE a.story_id = story.id)`,
    );
    await pool.end();
    await app.close();
  });

  it('writes each item once, and nothing the second time over the same feed', async () => {
    const url = `https://scripted.test/summary-${RUN}.xml`;
    transport.answers.set(url, { status: 200, body: feedXml('Testville win') });
    const id = await source('summary', url);
    const src = (await pool.query(`SELECT * FROM news_source WHERE id = $1`, [id])).rows[0];

    const first = await service.fetchSource(src);
    expect(first).toMatchObject({ itemsSeen: 2, itemsWritten: 2, partial: null });
    const second = await service.fetchSource(src);
    expect(second).toMatchObject({ itemsSeen: 2, itemsWritten: 0, partial: null });

    const { rows } = await versions(id);
    expect(rows).toEqual([
      {
        external_id: `one-${RUN}`,
        version_number: 1,
        headline: 'Testville win',
        summary: 'What the publisher wrote.',
      },
      { external_id: `two-${RUN}`, version_number: 1, headline: `Second ${RUN}`, summary: null },
    ]);
    const runs = (await fetches(id)).rows;
    expect(runs.map((r) => [r.status, r.items_seen, r.items_written])).toEqual([
      ['succeeded', 2, 2],
      ['succeeded', 2, 0],
    ]);
  });

  it('keeps the old words when the feed changes its mind: a new version, not an edit', async () => {
    const url = `https://scripted.test/changing-${RUN}.xml`;
    transport.answers.set(url, { status: 200, body: feedXml('Before') });
    const id = await source('summary', url);
    const src = (await pool.query(`SELECT * FROM news_source WHERE id = $1`, [id])).rows[0];
    await service.fetchSource(src);
    transport.answers.set(url, { status: 200, body: feedXml('After correction') });
    const report = await service.fetchSource(src);
    expect(report.itemsWritten).toBe(1);
    const { rows } = await versions(id);
    expect(
      rows.filter((r) => r.external_id === `one-${RUN}`).map((r) => [r.version_number, r.headline]),
    ).toEqual([
      [1, 'Before'],
      [2, 'After correction'],
    ]);
  });

  it('stores no summary for a source that grants the headline only, before the database has to refuse it', async () => {
    const url = `https://scripted.test/headline-${RUN}.xml`;
    transport.answers.set(url, {
      status: 200,
      body: feedXml('Only this', 'A summary we may not keep'),
    });
    const id = await source('headline', url);
    const src = (await pool.query(`SELECT * FROM news_source WHERE id = $1`, [id])).rows[0];
    const report = await service.fetchSource(src);
    expect(report).toMatchObject({ itemsWritten: 2, partial: null });
    const { rows } = await versions(id);
    expect(rows.every((r) => r.summary === null)).toBe(true);
  });

  it("obeys the publisher's robots.txt, and records why nothing was read", async () => {
    const url = `https://forbidden.test/feed-${RUN}.xml`;
    transport.answers.set('https://forbidden.test/robots.txt', {
      status: 200,
      body: 'User-agent: *\nDisallow: /feed-',
    });
    transport.answers.set(url, { status: 200, body: feedXml('Never read') });
    const id = await source('summary', url);
    const src = (await pool.query(`SELECT * FROM news_source WHERE id = $1`, [id])).rows[0];
    const report = await service.fetchSource(src);
    expect(report.partial).toMatch(/robots\.txt at https:\/\/forbidden\.test disallows/);
    expect(transport.asked).not.toContain(url);
    expect((await versions(id)).rows).toEqual([]);
    expect((await fetches(id)).rows[0]).toMatchObject({ status: 'partial', items_seen: 0 });
  });

  it('records a feed that is missing or not a feed as a partial run naming the reason', async () => {
    const gone = await source('summary', `https://scripted.test/gone-${RUN}.xml`);
    const notFeed = `https://scripted.test/html-${RUN}.xml`;
    transport.answers.set(notFeed, { status: 200, body: '<html><body>Moved</body></html>' });
    const odd = await source('summary', notFeed);
    for (const [id, expected] of [
      [gone, /^http: feed answered 404/],
      [odd, /^malformed: /],
    ] as const) {
      const src = (await pool.query(`SELECT * FROM news_source WHERE id = $1`, [id])).rows[0];
      const report = await service.fetchSource(src);
      expect(report.partial).toMatch(expected);
      expect((await fetches(id)).rows[0]).toMatchObject({ status: 'partial', items_written: 0 });
    }
  });

  it('does not read a dropped source at all', async () => {
    const url = `https://scripted.test/dropped-${RUN}.xml`;
    transport.answers.set(url, { status: 200, body: feedXml('Never') });
    await source('summary', url, true);
    const asked = transport.asked.length;
    const reports = await service.fetchAll();
    expect(reports.map((r) => r.name)).not.toContain(expect.stringContaining('dropped'));
    expect(transport.asked.slice(asked)).not.toContain(url);
  });
});
