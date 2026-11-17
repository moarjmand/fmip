import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresFollowingFeedStore } from '../following-feed/internal/following-feed-store';
import { PostgresCommunitySearchStore } from '../search/internal/community-search-store';
import { NO_FILTERS, PostgresNewsReadStore } from './internal/news-read-store';

/**
 * Football only on the news pages (T-1841, D-429), over Postgres. A general
 * sports feed (stored under Tehran Times' own feed address) has its chess
 * story -- the one a reader saw on 2026-11-16 -- and a story naming no sport
 * left out, and its football report listed; a Persian feed's story filed to a
 * club of ours under the publisher's «منهای فوتبال > والیبال» section is left
 * out of the lists, the Following feed and story search, beside a football
 * report filed to the same club. Nothing is deleted.
 *
 * T-1874 (D-449): an English feed's story at a showbiz address, filed to the
 * same club, is left out of the three beside the club's football report.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const COUNTRY = '00000000-0000-4000-8000-000000000101';
const TEAM = randomUUID();

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('football only (T-1841)', () => {
  let pool: Pool;
  let general: string;
  let persian: string;
  const stories: string[] = [];

  async function story(
    source: string,
    language: string,
    headline: string,
    summary: string | null,
    categories: string[],
    filed: boolean,
    minutesAgo: number,
    url = `https://fo.test/${RUN}/${stories.length}`,
  ): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO story DEFAULT VALUES RETURNING id`,
    );
    const storyId = rows[0]!.id;
    const article = await pool.query<{ id: string }>(
      `INSERT INTO article (source_id, story_id, external_id, url, fetched_at)
       VALUES ($1, $2, $3, $4, now() - make_interval(mins => $5)) RETURNING id`,
      [source, storyId, `fo-${stories.length}-${RUN}`, url, minutesAgo],
    );
    const articleId = article.rows[0]!.id;
    await pool.query(
      `INSERT INTO article_version (article_id, language, version_number, headline, summary, published_at)
       VALUES ($1, $2, 1, $3, $4, now() - make_interval(mins => $5))`,
      [articleId, language, headline, summary, minutesAgo],
    );
    for (const [position, category] of categories.entries()) {
      await pool.query(
        `INSERT INTO article_category (article_id, category, position) VALUES ($1, $2, $3)`,
        [articleId, category, position],
      );
    }
    if (filed) {
      await pool.query(
        `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
        [articleId, TEAM],
      );
    }
    await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
      storyId,
      articleId,
    ]);
    stories.push(storyId);
    return storyId;
  }

  let chess: string;
  let noSport: string;
  let pgpl: string;
  let volleyball: string;
  let report: string;
  let english: string;
  let showbiz: string;
  let englishReport: string;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    await pool.query(
      `INSERT INTO team (id, country_id, name, kind, gender) VALUES ($1, $2, $3, 'club', 'men')`,
      [TEAM, COUNTRY, `Footballford ${RUN}`],
    );
    const source = async (name: string, feed: string, language: string): Promise<string> =>
      (
        await pool.query<{ id: string }>(
          `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
           VALUES ($1, 'https://fo.test', $2, 'rss', 'summary', $3) RETURNING id`,
          [name, feed, language],
        )
      ).rows[0]!.id;
    general = await source(`General ${RUN}`, 'https://www.tehrantimes.com/rss/tp/699', 'en');
    persian = await source(`Persian ${RUN}`, `https://fo.test/${RUN}.xml`, 'fa');
    english = await source(`English ${RUN}`, `https://fo.test/${RUN}-en.xml`, 'en');

    chess = await story(
      general,
      'en',
      `Iranian chess players win golds at Open SCO Cup ${RUN}`,
      'TEHRAN – Iran’s female chess player Mobina Alinasab and her compatriot Reza Mahdavi claimed two gold medals at the Shanghai Cooperation Organisation (SCO) Open Cup in Russia on Monday.',
      ['Sports'],
      false,
      1,
    );
    noSport = await story(
      general,
      'en',
      `Iran sends 70 athletes to Open SCO Cup ${RUN}`,
      null,
      ['Sports'],
      false,
      2,
    );
    pgpl = await story(
      general,
      'en',
      `Tractor beat Kheybar in 2026/27 PGPL ${RUN}`,
      null,
      ['Sports'],
      false,
      3,
    );
    volleyball = await story(
      persian,
      'fa',
      `پرسپولیس در لیگ دسته اول والیبال ${RUN}`,
      null,
      ['منهای فوتبال > والیبال'],
      true,
      4,
    );
    report = await story(
      persian,
      'fa',
      `پرسپولیس در لیگ برتر فوتبال پیروز شد ${RUN}`,
      null,
      ['فوتبال > لیگ برتر ایران'],
      true,
      5,
    );
    showbiz = await story(
      english,
      'en',
      `Footballford star's wife floods him with love amid major career first ${RUN}`,
      null,
      [],
      true,
      6,
      `https://www.fo.test/news/showbiz-news/${RUN}-wife-floods-34822252`,
    );
    englishReport = await story(
      english,
      'en',
      `Footballford star scores twice in derby win ${RUN}`,
      null,
      [],
      true,
      7,
      `https://www.fo.test/sport/football/football-news/${RUN}-derby-34822253`,
    );
  }, 60_000);

  afterAll(async () => {
    await pool.query(`UPDATE story SET promoted_article_id = NULL WHERE id = ANY($1::uuid[])`, [
      stories,
    ]);
    const sources = [general, persian, english];
    await pool.query(`DELETE FROM article WHERE source_id = ANY($1::uuid[])`, [sources]);
    await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
    await pool.query(`DELETE FROM news_source WHERE id = ANY($1::uuid[])`, [sources]);
    await pool.query(`DELETE FROM team WHERE id = $1`, [TEAM]);
    await pool.end();
  }, 60_000);

  it('leaves a general feed’s chess and no-sport stories out of latest and lists its football', async () => {
    const ids = (
      await new PostgresNewsReadStore(pool).latest(NO_FILTERS, 'en', null, 50)
    ).cards.map((c) => c.story_id);
    expect(ids).toContain(pgpl);
    expect(ids).not.toContain(chess);
    expect(ids).not.toContain(noSport);
  });

  it('leaves another sport’s section out even when filed, in the lists, the feed and search', async () => {
    const lists = (
      await new PostgresNewsReadStore(pool).latest({ ...NO_FILTERS, team: TEAM }, 'fa', null, 40)
    ).cards.map((c) => c.story_id);
    expect(lists).toContain(report);
    expect(lists).not.toContain(volleyball);

    const fed = (
      await new PostgresFollowingFeedStore(pool).stories(
        [TEAM],
        [],
        {
          since: new Date(Date.now() - 3_600_000).toISOString(),
          until: new Date(Date.now() + 60_000).toISOString(),
        },
        randomUUID(),
        'fa',
      )
    ).map((r) => r.story_id);
    expect(fed).toContain(report);
    expect(fed).not.toContain(volleyball);

    const found = (
      await new PostgresCommunitySearchStore(pool).stories(`پرسپولیس ${RUN}`, 10, 'fa')
    ).map((r) => r.story_id);
    expect(found).toContain(report);
    expect(found).not.toContain(volleyball);
  });

  it('leaves a showbiz section out even when filed, in the lists, the feed and search (T-1874)', async () => {
    const lists = (
      await new PostgresNewsReadStore(pool).latest({ ...NO_FILTERS, team: TEAM }, 'en', null, 40)
    ).cards.map((c) => c.story_id);
    expect(lists).toContain(englishReport);
    expect(lists).not.toContain(showbiz);

    const fed = (
      await new PostgresFollowingFeedStore(pool).stories(
        [TEAM],
        [],
        {
          since: new Date(Date.now() - 3_600_000).toISOString(),
          until: new Date(Date.now() + 60_000).toISOString(),
        },
        randomUUID(),
        'en',
      )
    ).map((r) => r.story_id);
    expect(fed).toContain(englishReport);
    expect(fed).not.toContain(showbiz);

    const found = (
      await new PostgresCommunitySearchStore(pool).stories(`Footballford star ${RUN}`, 10, 'en')
    ).map((r) => r.story_id);
    expect(found).toContain(englishReport);
    expect(found).not.toContain(showbiz);
  });

  it('deletes nothing', async () => {
    const { rows } = await pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM article WHERE story_id = ANY($1::uuid[])`,
      [[chess, noSport, volleyball, showbiz]],
    );
    expect(rows[0]!.n).toBe(4);
  });
});
