import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_FILTERS, PostgresNewsReadStore } from './internal/news-read-store';

/**
 * Headlines the lists do not show (T-1818, D-413), over Postgres: an
 * invitation to watch a match live on the publisher's site is left out of
 * the latest list for every reader, the report stored beside it is listed,
 * and the invitation's row is still stored -- the rule is applied on read.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'headlines the lists do not show',
  () => {
    let pool: Pool;
    let source: string;
    const stories: string[] = [];

    async function story(headline: string, minutesAgo: number): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO story DEFAULT VALUES RETURNING id`,
      );
      const storyId = rows[0]!.id;
      const article = await pool.query<{ id: string }>(
        `INSERT INTO article (source_id, story_id, external_id, url, fetched_at)
         VALUES ($1, $2, $3, $4, now() - make_interval(mins => $5)) RETURNING id`,
        [
          source,
          storyId,
          `hidden-${stories.length}-${RUN}`,
          `https://hidden.test/${RUN}/${stories.length}`,
          minutesAgo,
        ],
      );
      const articleId = article.rows[0]!.id;
      await pool.query(
        `INSERT INTO article_version (article_id, language, version_number, headline, summary, published_at)
         VALUES ($1, 'fa', 1, $2, NULL, now() - make_interval(mins => $3))`,
        [articleId, headline, minutesAgo],
      );
      await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
        storyId,
        articleId,
      ]);
      stories.push(storyId);
      return storyId;
    }

    let invitation: string;
    let report: string;

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      const src = await pool.query<{ id: string }>(
        `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
         VALUES ($1, 'https://hidden.test', $2, 'rss', 'summary', 'fa') RETURNING id`,
        [`Hidden ${RUN}`, `https://hidden.test/${RUN}.xml`],
      );
      source = src.rows[0]!.id;
      invitation = await story(`پخش زنده بازی سپاهان و تراکتور ${RUN} + تماشای رایگان`, 1);
      report = await story(`حق پخش زنده بازی‌ها به صداوسیما رسید ${RUN}`, 2);
    }, 60_000);

    afterAll(async () => {
      await pool.query(`UPDATE story SET promoted_article_id = NULL WHERE id = ANY($1::uuid[])`, [
        stories,
      ]);
      await pool.query(`DELETE FROM article WHERE source_id = $1`, [source]);
      await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
      await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
      await pool.end();
    }, 60_000);

    it('leaves the invitation out of latest for every reader and lists the report', async () => {
      const store = new PostgresNewsReadStore(pool);
      for (const locale of ['fa', 'de', null]) {
        const ids = (await store.latest(NO_FILTERS, locale, null, 40)).cards.map((c) => c.story_id);
        expect(ids, String(locale)).toContain(report);
        expect(ids, String(locale)).not.toContain(invitation);
      }
    });

    it('deletes nothing: the invitation is still stored', async () => {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM article WHERE story_id = $1`,
        [invitation],
      );
      expect(rows[0]!.n).toBe(1);
    });
  },
);
