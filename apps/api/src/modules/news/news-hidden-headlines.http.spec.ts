import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresFollowingFeedStore } from '../following-feed/internal/following-feed-store';
import { PostgresCommunitySearchStore } from '../search/internal/community-search-store';
import { NO_FILTERS, PostgresNewsReadStore } from './internal/news-read-store';

/**
 * Headlines the lists do not show (T-1818, D-413), over Postgres: an
 * invitation to watch a match live on the publisher's site (read on a team
 * of its own, so other specs' stories cannot crowd it out) is left out of
 * the news lists, the Following feed and story search for every reader; a
 * report that starts with the same words but invites nobody to watch is
 * shown, and so is the report beside them; the invitation's row is still
 * stored -- the rule is applied on read.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const TEAM = randomUUID();

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
      await pool.query(
        `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
        [articleId, TEAM],
      );
      await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
        storyId,
        articleId,
      ]);
      stories.push(storyId);
      return storyId;
    }

    let invitation: string;
    let cancelled: string;
    let report: string;

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      await pool.query(
        `INSERT INTO team (id, country_id, name, kind, gender) VALUES ($1, $2, $3, 'club', 'men')`,
        [TEAM, ENGLAND, `Hiddenford ${RUN}`],
      );
      const src = await pool.query<{ id: string }>(
        `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
         VALUES ($1, 'https://hidden.test', $2, 'rss', 'summary', 'fa') RETURNING id`,
        [`Hidden ${RUN}`, `https://hidden.test/${RUN}.xml`],
      );
      source = src.rows[0]!.id;
      invitation = await story(
        `پخش زنده بازی سپاهان و تراکتور ${RUN}/ تماشای رایگان لیگ برتر در سایت`,
        1,
      );
      cancelled = await story(`پخش زنده بازی سپاهان و تراکتور ${RUN} لغو شد`, 2);
      report = await story(`حق پخش زنده بازی سپاهان و تراکتور ${RUN} فروخته شد`, 3);
    }, 60_000);

    afterAll(async () => {
      await pool.query(`UPDATE story SET promoted_article_id = NULL WHERE id = ANY($1::uuid[])`, [
        stories,
      ]);
      await pool.query(`DELETE FROM article WHERE source_id = $1`, [source]);
      await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
      await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
      await pool.query(`DELETE FROM team WHERE id = $1`, [TEAM]);
      await pool.end();
    }, 60_000);

    it('leaves the invitation out of latest for every reader and lists the reports', async () => {
      const store = new PostgresNewsReadStore(pool);
      for (const locale of ['fa', 'de', null]) {
        const ids = (await store.latest({ ...NO_FILTERS, team: TEAM }, locale, null, 40)).cards.map(
          (c) => c.story_id,
        );
        expect(ids, String(locale)).toContain(report);
        expect(ids, String(locale)).toContain(cancelled);
        expect(ids, String(locale)).not.toContain(invitation);
      }
    });

    it('leaves it out of the Following feed and story search too', async () => {
      const feed = await new PostgresFollowingFeedStore(pool).stories(
        [TEAM],
        [],
        {
          since: new Date(Date.now() - 3_600_000).toISOString(),
          until: new Date(Date.now() + 60_000).toISOString(),
        },
        randomUUID(),
        'fa',
      );
      const fed = feed.map((r) => r.story_id);
      expect(fed).toEqual(expect.arrayContaining([cancelled, report]));
      expect(fed).not.toContain(invitation);

      const found = (
        await new PostgresCommunitySearchStore(pool).stories(`سپاهان و تراکتور ${RUN}`, 10, 'fa')
      ).map((r) => r.story_id);
      expect(found).toContain(cancelled);
      expect(found).not.toContain(invitation);
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
