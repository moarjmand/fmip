import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Transport, TransportResponse } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { GNEWS_SOURCE_ID } from './internal/gnews-store';
import { NEWS_TRANSPORT } from './internal/news-transport';
import { type GNewsConfig, GNewsIngestionService } from './gnews-ingestion.service';
import { NewsModule } from './news.module';

/**
 * The GNews job against the real schema (T-1367, D-185), every answer
 * scripted. Each test reads through an aggregator row of its own, so the
 * seeded GNews row and the day's count of another test are never touched.
 *
 * What matters: no key, no request and no row; each article is filed under
 * its original publisher, with title, description and link and nothing else;
 * the second run writes nothing; a page another source carries is not
 * written again; a dropped publisher is not brought back; the daily ceiling
 * is counted from the runs and refuses without asking; a refusal names
 * GNews' words and never the key.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const KEY = `test-key-${RUN}`;
const ON: GNewsConfig = { on: true, apiKey: KEY, dailyBudget: 90, intervalMinutes: 30 };

interface Article {
  title: string;
  description?: string;
  content?: string;
  url: string;
  image?: string;
  publishedAt?: string;
  /** `name` absent is how an article without a nameable publisher arrives. */
  source: { name?: string; url?: string };
}

/** Answers GNews' search with whatever `next` holds; everything else is a 404. */
class ScriptedGNews implements Transport {
  readonly asked: string[] = [];
  next: { status: number; body: unknown } = { status: 200, body: { articles: [] } };
  async request(url: string): Promise<TransportResponse> {
    this.asked.push(url);
    const hit = url.startsWith('https://gnews.io/api/v4/search?')
      ? this.next
      : { status: 404, body: 'not here' };
    return { status: hit.status, body: hit.body, receivedAt: new Date().toISOString() };
  }
  answer(articles: Article[]): void {
    this.next = { status: 200, body: JSON.stringify({ totalArticles: articles.length, articles }) };
  }
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('gnews ingestion', () => {
  let pool: Pool;
  let app: NestFastifyApplication;
  let service: GNewsIngestionService;
  let transport: ScriptedGNews;
  const created: string[] = [];

  const aggregator = async (dropped = false): Promise<string> => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, kind, rights, language, same_language_only,
                                dropped_at, dropped_reason)
       VALUES ($1, 'https://gnews.test', 'licensed', 'summary', 'en', true, $2, $3) RETURNING id`,
      [`GNews ${created.length} ${RUN}`, dropped ? new Date() : null, dropped ? 'stopped' : null],
    );
    created.push(rows[0]!.id);
    return rows[0]!.id;
  };

  const fetches = (sourceId: string) =>
    pool.query<{ status: string; items_seen: number; items_written: number; error: string | null }>(
      `SELECT status, items_seen, items_written, error FROM news_fetch
        WHERE source_id = $1 ORDER BY started_at`,
      [sourceId],
    );

  const filed = (aggregatorId: string) =>
    pool.query<{
      publisher: string;
      homepage_url: string;
      kind: string;
      rights: string;
      same_language_only: boolean;
      url: string;
      headline: string;
      summary: string | null;
      published_at: Date | null;
      versions: number;
    }>(
      `SELECT s.name AS publisher, s.homepage_url, s.kind, s.rights, s.same_language_only,
              a.url, v.headline, v.summary, v.published_at,
              (SELECT count(*)::int FROM article_version x WHERE x.article_id = a.id) AS versions
         FROM news_source s
         JOIN article a ON a.source_id = s.id
         JOIN article_version v ON v.article_id = a.id
        WHERE s.via_source_id = $1
        ORDER BY a.url`,
      [aggregatorId],
    );

  beforeAll(async () => {
    transport = new ScriptedGNews();
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, NewsModule] })
      .overrideProvider(NEWS_TRANSPORT)
      .useValue(transport)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    service = moduleRef.get(GNewsIngestionService);
    pool = new Pool({ connectionString: DATABASE_URL });
  });

  afterAll(async () => {
    if (created.length > 0) {
      // Publishers go with their aggregator (ON DELETE CASCADE), articles with them.
      await pool.query(`DELETE FROM news_source WHERE id = ANY($1::uuid[])`, [created]);
    }
    await pool.query(
      `DELETE FROM story WHERE NOT EXISTS (SELECT 1 FROM article a WHERE a.story_id = story.id)`,
    );
    await pool.end();
    await app.close();
  });

  it('asks nothing and writes nothing without a key', async () => {
    const before = (await fetches(GNEWS_SOURCE_ID)).rows.length;
    const asked = transport.asked.length;
    const off = await service.run({ on: false, reason: 'GNEWS_API_KEY is empty' });
    expect(off).toBeNull();
    expect(transport.asked.length).toBe(asked);
    expect((await fetches(GNEWS_SOURCE_ID)).rows.length).toBe(before);
  });

  it('the seeded GNews row is licensed, summary, English, for English readers, with no photo right', async () => {
    const { rows } = await pool.query(
      `SELECT name, kind, rights, language, same_language_only, feed_url, image_licence, via_source_id
         FROM news_source WHERE id = $1`,
      [GNEWS_SOURCE_ID],
    );
    expect(rows[0]).toEqual({
      name: 'GNews',
      kind: 'licensed',
      rights: 'summary',
      language: 'en',
      same_language_only: true,
      feed_url: null,
      image_licence: null,
      via_source_id: null,
    });
  });

  it('files each article under its original publisher, once, with no content and no photo', async () => {
    const id = await aggregator();
    transport.answer([
      {
        title: `Testville win the derby ${RUN}`,
        description: 'A late goal settled it.',
        content: `The truncated body ${RUN} ... [2000 chars]`,
        url: `https://www.post-${RUN}.example/football/derby`,
        image: `https://cdn.post-${RUN}.example/derby.jpg`,
        publishedAt: '2026-10-04T09:30:00Z',
        source: { name: `The Example Post ${RUN}`, url: `https://www.post-${RUN}.example` },
      },
      {
        title: `Otherton sack their manager ${RUN}`,
        url: `https://times-${RUN}.example/sport/sacking`,
        source: { name: `Example Times ${RUN}` },
      },
      { title: 'Nobody wrote this', url: `https://anon-${RUN}.example/x`, source: {} },
    ]);

    const first = await service.run(ON, id);
    expect(first).toMatchObject({ itemsSeen: 2, itemsWritten: 2 });
    expect(first!.partial).toContain('1 article(s)');
    const asked = new URL(transport.asked.at(-1)!);
    expect(asked.searchParams.get('lang')).toBe('en');

    const { rows } = await filed(id);
    expect(rows).toEqual([
      {
        publisher: `Example Times ${RUN}`,
        homepage_url: `https://times-${RUN}.example`,
        kind: 'licensed',
        rights: 'summary',
        same_language_only: true,
        url: `https://times-${RUN}.example/sport/sacking`,
        headline: `Otherton sack their manager ${RUN}`,
        summary: null,
        published_at: null,
        versions: 1,
      },
      {
        publisher: `The Example Post ${RUN}`,
        homepage_url: `https://www.post-${RUN}.example`,
        kind: 'licensed',
        rights: 'summary',
        same_language_only: true,
        url: `https://www.post-${RUN}.example/football/derby`,
        headline: `Testville win the derby ${RUN}`,
        summary: 'A late goal settled it.',
        published_at: new Date('2026-10-04T09:30:00Z'),
        versions: 1,
      },
    ]);
    const content = await pool.query(
      `SELECT count(*)::int AS n FROM article_version WHERE body LIKE $1 OR summary LIKE $1`,
      [`%truncated body ${RUN}%`],
    );
    expect(content.rows[0].n).toBe(0);
    const images = await pool.query(
      `SELECT count(*)::int AS n FROM article_image i JOIN article a ON a.id = i.article_id
         JOIN news_source s ON s.id = a.source_id WHERE s.via_source_id = $1`,
      [id],
    );
    expect(images.rows[0].n).toBe(0);
    expect(transport.asked.some((u) => u.includes(`cdn.post-${RUN}`))).toBe(false);

    // The same answer again: nothing new, no second publisher row.
    const second = await service.run(ON, id);
    expect(second).toMatchObject({ itemsSeen: 2, itemsWritten: 0 });
    const publishers = await pool.query(
      `SELECT count(*)::int AS n FROM news_source WHERE via_source_id = $1`,
      [id],
    );
    expect(publishers.rows[0].n).toBe(2);
    // Every run is a news_fetch row of the aggregator.
    expect((await fetches(id)).rows.map((r) => r.status)).toEqual(['partial', 'partial']);
  });

  it('does not write a page another source already carries', async () => {
    const id = await aggregator();
    const feed = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
       VALUES ($1, $2, $3, 'rss', 'summary', 'en') RETURNING id`,
      [`Feed ${RUN}`, `https://www.dup-${RUN}.example`, `https://dup-${RUN}.example/rss`],
    );
    created.push(feed.rows[0]!.id);
    const story = await pool.query<{ id: string }>(`INSERT INTO story DEFAULT VALUES RETURNING id`);
    await pool.query(
      `INSERT INTO article (source_id, story_id, external_id, url) VALUES ($1, $2, 'one', $3)`,
      [
        feed.rows[0]!.id,
        story.rows[0]!.id,
        `https://www.dup-${RUN}.example/story/1/?at_medium=RSS&at_campaign=rss`,
      ],
    );
    transport.answer([
      {
        title: `Already carried ${RUN}`,
        url: `https://dup-${RUN}.example/story/1`,
        source: { name: `Dup ${RUN}`, url: `https://dup-${RUN}.example` },
      },
      {
        title: `Not carried ${RUN}`,
        url: `https://dup-${RUN}.example/story/2`,
        source: { name: `Dup ${RUN}`, url: `https://dup-${RUN}.example` },
      },
    ]);
    const report = await service.run(ON, id);
    expect(report).toMatchObject({ itemsSeen: 2, itemsWritten: 1, partial: null });
    expect((await filed(id)).rows.map((r) => r.headline)).toEqual([`Not carried ${RUN}`]);
  });

  it('does not bring back a dropped publisher, read directly or through GNews', async () => {
    const id = await aggregator();
    const direct = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language,
                                dropped_at, dropped_reason)
       VALUES ($1, $2, $3, 'rss', 'summary', 'en', now(), 'asked to be dropped') RETURNING id`,
      [`Gone ${RUN}`, `https://gone-${RUN}.example`, `https://feeds.other-${RUN}.example/gone`],
    );
    created.push(direct.rows[0]!.id);
    const article = (host: string, n: number): Article => ({
      title: `${host} ${n} ${RUN}`,
      url: `https://${host}-${RUN}.example/a/${n}`,
      source: { name: `${host} ${RUN}`, url: `https://www.${host}-${RUN}.example` },
    });
    transport.answer([article('gone', 1), article('kept', 1)]);
    expect(await service.run(ON, id)).toMatchObject({ itemsSeen: 2, itemsWritten: 1 });

    expect((await filed(id)).rows.map((r) => r.headline)).toEqual([`kept 1 ${RUN}`]);

    // The console drops the GNews publisher (its items go with it, as any
    // dropped source's do): its next article is not written.
    await pool.query(
      `UPDATE news_source SET dropped_at = now(), dropped_reason = 'asked'
        WHERE via_source_id = $1 AND homepage_url = $2`,
      [id, `https://www.kept-${RUN}.example`],
    );
    transport.answer([article('kept', 2)]);
    expect(await service.run(ON, id)).toMatchObject({ itemsSeen: 1, itemsWritten: 0 });
    expect((await filed(id)).rows).toEqual([]);
  });

  it('holds the daily ceiling from the stored runs, asking nothing once it is spent', async () => {
    const id = await aggregator();
    transport.answer([]);
    const one = { ...ON, dailyBudget: 1 };
    expect(await service.run(one, id)).toMatchObject({ partial: null });
    const asked = transport.asked.length;
    const refused = await service.run(one, id);
    expect(refused!.partial).toBe('daily request budget of 1 spent');
    expect(transport.asked.length).toBe(asked);
    // A refused run sent nothing, so it does not count: a ceiling of 2 allows one more.
    expect(await service.run({ ...ON, dailyBudget: 2 }, id)).toMatchObject({ partial: null });
    expect(transport.asked.length).toBe(asked + 1);
    expect((await service.run({ ...ON, dailyBudget: 2 }, id))!.partial).toBe(
      'daily request budget of 2 spent',
    );
  });

  it("records GNews' refusal in its words, never the key", async () => {
    const id = await aggregator();
    transport.next = { status: 401, body: { errors: ['You did not provide a valid API key.'] } };
    const report = await service.run(ON, id);
    expect(report!.partial).toBe('http: GNews answered 401: You did not provide a valid API key.');
    const { rows } = await fetches(id);
    expect(rows).toEqual([expect.objectContaining({ status: 'partial', error: report!.partial })]);
    expect(JSON.stringify(rows)).not.toContain(KEY);
  });

  it('asks nothing when its row is dropped', async () => {
    const id = await aggregator(true);
    const asked = transport.asked.length;
    expect(await service.run(ON, id)).toBeNull();
    expect(transport.asked.length).toBe(asked);
    expect((await fetches(id)).rows).toEqual([]);
  });
});
