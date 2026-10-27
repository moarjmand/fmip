import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Transport, TransportResponse } from '@fmip/ingestion';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { GNEWS_SOURCE_ID } from './internal/gnews-store';
import { NO_FILTERS, PostgresNewsReadStore } from './internal/news-read-store';
import { NEWS_TRANSPORT } from './internal/news-transport';
import { NewsIngestionService } from './news-ingestion.service';
import { NewsModule } from './news.module';

/**
 * One report shown once, and no item that is not an article (T-1396, D-211),
 * against the real schema with every feed scripted. The headlines are as
 * they stood on production's English news page on 2026-10-12: the same
 * Independent piece syndicated by Yahoo Sports, one CBS Sports betting page
 * at two addresses, two Fayetteville Observer report cards sharing one
 * headline, a live ticker and a where-to-watch page.
 *
 * At the job: a page another source already carries (tracking parameters,
 * `www.` and the fragment aside) is not written; nor is a report the same
 * publisher already carries under the same headline with an agreeing
 * summary; another publisher's copy joins the first one's story; and an item
 * whose own headline says it is not an article is not written. At read time,
 * the same holds for what was stored before.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const TEAM = randomUUID();
const TEAM_NAME = `Dedupeton ${RUN}`;

class ScriptedTransport implements Transport {
  constructor(readonly answers: Map<string, { status: number; body: string }>) {}
  async request(url: string): Promise<TransportResponse> {
    const hit = this.answers.get(url) ?? { status: 404, body: 'not here' };
    return { status: hit.status, body: hit.body, receivedAt: new Date().toISOString() };
  }
}

interface Item {
  headline: string;
  link: string;
  summary?: string;
  pubDate?: string;
}

const feed = (items: Item[]): string =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>Scripted</title><language>en</language>${items
    .map(
      (i) =>
        `<item><title>${i.headline}</title><link>${i.link.replace(/&/g, '&amp;')}</link><guid>${randomUUID()}</guid>` +
        `<pubDate>${i.pubDate ?? 'Sun, 11 Oct 2026 19:45:00 GMT'}</pubDate>` +
        `${i.summary === undefined ? '' : `<description>${i.summary}</description>`}</item>`,
    )
    .join('')}</channel></rss>`;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('news dedupe (T-1396)', () => {
  let pool: Pool;
  let app: NestFastifyApplication;
  let service: NewsIngestionService;
  let reader: PostgresNewsReadStore;
  let transport: ScriptedTransport;
  const sources: string[] = [];

  /** A source of its own, on `site`, reading the given items once. */
  async function read(site: string, items: Item[]): Promise<{ id: string; written: number }> {
    const feedUrl = `https://${site}/feed-${randomUUID()}.xml`;
    transport.answers.set(feedUrl, { status: 200, body: feed(items) });
    // Stored without a feed, so a job reading every active feed -- another
    // spec's, running beside this one -- never reaches it; read here by hand.
    const { rows } = await pool.query(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
       VALUES ($1, $2, NULL, 'licensed', 'summary', 'en') RETURNING *`,
      [`Dedupe ${site} ${RUN} ${sources.length}`, `https://www.${site}/`],
    );
    sources.push(rows[0].id);
    const report = await service.fetchSource({ ...rows[0], kind: 'rss', feed_url: feedUrl });
    return { id: rows[0].id, written: report.itemsWritten };
  }

  async function headlines(sourceId: string): Promise<string[]> {
    const { rows } = await pool.query<{ headline: string }>(
      `SELECT v.headline FROM article a JOIN article_version v ON v.article_id = a.id
        WHERE a.source_id = $1 ORDER BY v.headline`,
      [sourceId],
    );
    return rows.map((r) => r.headline);
  }

  beforeAll(async () => {
    transport = new ScriptedTransport(new Map());
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, NewsModule] })
      .overrideProvider(NEWS_TRANSPORT)
      .useValue(transport)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    service = moduleRef.get(NewsIngestionService);
    pool = new Pool({ connectionString: DATABASE_URL });
    reader = new PostgresNewsReadStore(pool);
    await pool.query(
      `INSERT INTO team (id, country_id, name, kind, gender) VALUES ($1, $2, $3, 'club', 'men')`,
      [TEAM, ENGLAND, TEAM_NAME],
    );
  });

  afterAll(async () => {
    if (sources.length > 0) {
      await pool.query(`DELETE FROM news_source WHERE id = ANY($1::uuid[])`, [sources]);
    }
    await pool.query(
      `DELETE FROM story WHERE NOT EXISTS (SELECT 1 FROM article a WHERE a.story_id = story.id)`,
    );
    await pool.query(`DELETE FROM team WHERE id = $1`, [TEAM]);
    await pool.end();
    await app.close();
  });

  it('writes a page once, whatever tracking its address carries', async () => {
    const page = `https://pub-a-${RUN}.test/sport/football/maresca-noise-${RUN}`;
    const first = await read(`pub-a-${RUN}.test`, [
      {
        headline: `Maresca on noise ${RUN}`,
        link: `${page}?utm_source=rss&utm_medium=feed`,
        summary: 'One.',
      },
    ]);
    expect(first.written).toBe(1);
    // Another source listing the same page: www., a trailing slash, other tracking, a fragment.
    const again = await read(`aggregator-${RUN}.test`, [
      {
        headline: `Maresca on noise ${RUN} (via aggregator)`,
        link: `${page.replace('https://', 'https://www.')}/?ocid=social&utm_campaign=x#comments`,
        summary: 'One.',
      },
    ]);
    expect(again.written).toBe(0);
    expect(await headlines(again.id)).toEqual([]);
  });

  it('writes a publisher’s report once when two of its feeds or addresses carry it', async () => {
    const site = `cbssports-${RUN}.test`;
    const headline = `Polymarket promo ${RUN}: Claim $25 for Georgia-Alabama, USC-Penn State picks`;
    const summary = 'College football picks for Week 7 with a new-user offer.';
    const first = await read(site, [
      { headline, link: `https://${site}/betting/claim-25-bonus-for-georgia-alabama`, summary },
    ]);
    expect(first.written).toBe(1);
    // The same site's other feed, the same piece at a second slug.
    const second = await read(site, [
      { headline, link: `https://${site}/betting/claim-25-bonus-georgia-alabama`, summary },
    ]);
    expect(second.written).toBe(0);
  });

  it('keeps two pieces a publisher gives one generic headline: their summaries differ', async () => {
    const site = `fayobserver-${RUN}.test`;
    const headline = `Offense, defense, coaching report card ${RUN}`;
    const { id, written } = await read(site, [
      {
        headline,
        link: `https://${site}/duke-football-grades-vs-georgia-tech`,
        summary: 'Duke football grades after the loss at Georgia Tech, position by position.',
      },
      {
        headline,
        link: `https://${site}/unc-football-grades-pitt-loss`,
        summary: 'How North Carolina graded out in the defeat to Pittsburgh on Saturday night.',
      },
    ]);
    expect(written).toBe(2);
    expect(await headlines(id)).toHaveLength(2);
  });

  it('files another publisher’s copy under the first one’s story, with no team linked', async () => {
    // On production "Man City" linked no team, so the copy was never compared.
    const headline = `‘Our noise is to win games’; Enzo Maresca challenges Man City to continue winning mentality ${RUN}`;
    const independent = await read(`independent-${RUN}.test`, [
      { headline, link: `https://independent-${RUN}.test/sport/football/maresca-b3064876.html` },
    ]);
    const yahoo = await read(`yahoo-${RUN}.test`, [
      {
        headline,
        link: `https://yahoo-${RUN}.test/articles/noise-win-games-enzo-maresca-184505124.html`,
        summary: 'The Man City boss tasked his team with continuing their winning streak.',
        pubDate: 'Sun, 11 Oct 2026 19:46:00 GMT',
      },
    ]);
    expect([independent.written, yahoo.written]).toEqual([1, 1]);
    const { rows } = await pool.query<{ stories: number }>(
      `SELECT count(DISTINCT a.story_id)::int AS stories FROM article a WHERE a.source_id = ANY($1::uuid[])`,
      [[independent.id, yahoo.id]],
    );
    expect(rows[0]!.stories).toBe(1);
    const links = await pool.query(
      `SELECT 1 FROM article_entity e JOIN article a ON a.id = e.article_id WHERE a.source_id = ANY($1::uuid[])`,
      [[independent.id, yahoo.id]],
    );
    expect(links.rows).toEqual([]);
    const { rows: original } = await pool.query<{ source_id: string }>(
      `SELECT p.source_id FROM article a JOIN story s ON s.id = a.story_id
         JOIN article p ON p.id = s.promoted_article_id
        WHERE a.source_id = $1`,
      [yahoo.id],
    );
    expect(original[0]!.source_id).toBe(independent.id);
  });

  it('does not write an item whose own headline says it is not an article', async () => {
    const site = `independent-live-${RUN}.test`;
    const { id, written } = await read(site, [
      {
        headline: `${TEAM_NAME} vs Liverpool LIVE: Rayan Cherki adds third goal as City cruise to victory`,
        link: `https://${site}/live-1`,
      },
      {
        headline: `How to watch Liverpool v ${TEAM_NAME} as City return to action`,
        link: `https://${site}/watch-1`,
      },
      { headline: `${TEAM_NAME} cruise to victory at Anfield`, link: `https://${site}/report-1` },
    ]);
    expect(written).toBe(1);
    expect(await headlines(id)).toEqual([`${TEAM_NAME} cruise to victory at Anfield`]);
  });

  describe('what was stored before the job left it out', () => {
    /** A story of one report, written straight to the tables as the old job did, linked to TEAM. */
    async function stored(
      site: string,
      headline: string,
      summary: string | null,
      publishedAt: string,
      via: string | null = null,
      linked = true,
    ): Promise<string> {
      const src = await pool.query<{ id: string }>(
        `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language, via_source_id)
         VALUES ($1, $2, NULL, 'licensed', 'summary', 'en', $3) RETURNING id`,
        [`Stored ${site} ${randomUUID()}`, `https://${site}/`, via],
      );
      sources.push(src.rows[0]!.id);
      // The story and its article in one statement: no other spec ever sees an empty story.
      const made = await pool.query<{ id: string; story_id: string }>(
        `WITH st AS (INSERT INTO story DEFAULT VALUES RETURNING id)
         INSERT INTO article (source_id, story_id, external_id, url)
         SELECT $1, st.id, $2, $3 FROM st RETURNING id, story_id`,
        [src.rows[0]!.id, randomUUID(), `https://${site}/${randomUUID()}`],
      );
      const article = { rows: made.rows };
      const story = { rows: [{ id: made.rows[0]!.story_id }] };
      await pool.query(
        `INSERT INTO article_version (article_id, language, version_number, headline, summary, published_at)
         VALUES ($1, 'en', 1, $2, $3, $4)`,
        [article.rows[0]!.id, headline, summary, publishedAt],
      );
      await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
        story.rows[0]!.id,
        article.rows[0]!.id,
      ]);
      if (linked) {
        await pool.query(
          `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
          [article.rows[0]!.id, TEAM],
        );
      }
      return story.rows[0]!.id;
    }

    it('lists a report two stories carry once, the earlier one', async () => {
      const headline = `Stunning save or miss of the season? ${TEAM_NAME} keeper denies Delap`;
      const first = await stored(
        `independent-old-${RUN}.test`,
        headline,
        null,
        '2026-10-11T13:00:00Z',
      );
      const copy = await stored(
        `yahoo-old-${RUN}.test`,
        headline,
        'The keeper got a hand to it.',
        '2026-10-11T13:54:00Z',
      );
      // Two of one publisher's report cards under one headline stay two.
      const duke = await stored(
        `fayobserver-old-${RUN}.test`,
        `Report card ${RUN}`,
        'Duke football grades after the loss at Georgia Tech, position by position.',
        '2026-10-10T12:00:00Z',
      );
      const unc = await stored(
        `fayobserver-old-${RUN}.test`,
        `Report card ${RUN}`,
        'How North Carolina graded out in the defeat to Pittsburgh on Saturday night.',
        '2026-10-10T12:05:00Z',
      );
      const page = await reader.latest({ ...NO_FILTERS, team: TEAM }, 'en', null, 50);
      const listed = page.cards.map((c) => c.story_id);
      expect(listed).toContain(first);
      expect(listed).not.toContain(copy);
      expect(listed).toEqual(expect.arrayContaining([duke, unc]));
    });

    it('does not list an item whose own headline says it is not an article', async () => {
      const ticker = await stored(
        `independent-old-live-${RUN}.test`,
        `Liverpool vs ${TEAM_NAME} LIVE: Rayan Cherki adds third goal`,
        null,
        '2026-10-11T17:30:00Z',
      );
      const guide = await stored(
        `yahoo-old-guide-${RUN}.test`,
        `Serie A: Where to watch ${TEAM_NAME} vs. Roma on TV`,
        null,
        '2026-10-11T09:10:00Z',
      );
      const page = await reader.latest({ ...NO_FILTERS, team: TEAM }, 'en', null, 50);
      const listed = page.cards.map((c) => c.story_id);
      expect(listed).not.toContain(ticker);
      expect(listed).not.toContain(guide);
    });

    it('does not list an item a search brought about another code of football (T-1400)', async () => {
      // As GNews stored it on 2026-10-10, under a publisher reached through the search.
      const nfl = await stored(
        `vcstar-old-${RUN}.test`,
        `Falcons EDGE ruled out vs. Ravens in Week 5 ${TEAM_NAME}`,
        "Falcons downgrade EDGE Za'Darius Smith for Sunday Night Football game vs. Ravens",
        '2026-10-10T15:00:00Z',
        GNEWS_SOURCE_ID,
      );
      // A publisher's own feed is not judged by it: the Independent's piece on Kane.
      const feed = await stored(
        `independent-old-nfl-${RUN}.test`,
        `MLS boss urges Harry Kane to follow Messi and Beckham before NFL dream ${TEAM_NAME}`,
        null,
        '2026-10-10T15:05:00Z',
      );
      const page = await reader.latest({ ...NO_FILTERS, team: TEAM }, 'en', null, 50);
      const listed = page.cards.map((c) => c.story_id);
      expect(listed).not.toContain(nfl);
      expect(listed).toContain(feed);
    });

    it('does not list a feed item about another sport that is filed to none of ours (T-1619)', async () => {
      // As Yahoo Sports' soccer feed carried it on 2026-10-26: rugby union, no club of ours.
      const now = new Date().toISOString();
      const rugby = await stored(
        `yahoo-rugby-${RUN}.test`,
        `Ireland prop Furlong cited over alleged groin grab ${RUN}`,
        "Ireland prop Tadhg Furlong is cited over an alleged groin grab in Leinster's United Rugby Championship win over Munster on Saturday.",
        now,
        null,
        false,
      );
      // The same words filed to a club of ours stay: the club makes it football news.
      const filed = await stored(
        `yahoo-rugby-filed-${RUN}.test`,
        `${TEAM_NAME} stadium to host a Six Nations match ${RUN}`,
        null,
        now,
      );
      const listed = (await reader.latest(NO_FILTERS, 'en', null, 50)).cards.map((c) => c.story_id);
      expect(listed).not.toContain(rugby);
      expect(listed).toContain(filed);
    });
  });
});
