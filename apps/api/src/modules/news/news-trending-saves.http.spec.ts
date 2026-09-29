import { randomUUID } from 'node:crypto';
import { TRENDING_WINDOW_HOURS } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PostgresNewsReadStore } from './internal/news-read-store';
import { PostgresNewsStore } from './internal/news-store';

/**
 * Trending counts saves (T-1008, D-128) against the real schema: distinct
 * members who saved a story inside the window rank it beside the panel
 * discussion; a save older than the window is not counted; a save moved by a
 * cluster merge counts once; and the section stays within its query budget
 * -- two statements, well under a second -- over ten thousand saves.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const NO_FILTERS = {
  country: null,
  competition: null,
  team: null,
  language: null,
  type: null,
  player: null,
  from: null,
  to: null,
  time_zone: 'UTC',
};
/** The section's query budget: the cards and their entities, whatever the table holds. */
const QUERY_BUDGET = 2;
const TIME_BUDGET_MS = 1500;
const BULK_MEMBERS = 100;
const BULK_STORIES = 100;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'trending counts saves (T-1008)',
  () => {
    let pool: Pool;
    let read: PostgresNewsReadStore;
    let source: string;
    const members: string[] = [];

    async function member(name: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO user_account
           (username, display_name, email, country_id, preferred_language, timezone,
            accepted_rules_at, email_verified_at)
         VALUES ($1, $1, $1 || '@example.test', $2, 'en', 'Europe/London', now(), now())
         RETURNING id`,
        [`ts_${RUN}_${name}`, ENGLAND],
      );
      members.push(rows[0]!.id);
      return rows[0]!.id;
    }

    /** A story of one report, promoted as its own original; returns both ids. */
    async function story(headline: string): Promise<{ storyId: string; articleId: string }> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO story DEFAULT VALUES RETURNING id`,
      );
      const storyId = rows[0]!.id;
      const article = await pool.query<{ id: string }>(
        `INSERT INTO article (source_id, story_id, external_id, url)
         VALUES ($1, $2, $3, 'https://scripted.test/t') RETURNING id`,
        [source, storyId, `${headline}-${RUN}-${randomUUID()}`],
      );
      const articleId = article.rows[0]!.id;
      await pool.query(
        `INSERT INTO article_version (article_id, language, version_number, headline, published_at)
         VALUES ($1, 'en', 1, $2, now() - interval '1 hour')`,
        [articleId, headline],
      );
      await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
        storyId,
        articleId,
      ]);
      return { storyId, articleId };
    }

    async function save(user: string, s: { storyId: string; articleId: string }, ago = '1 hour') {
      await pool.query(
        `INSERT INTO saved_article (user_id, story_id, article_id, source_id, saved_at)
         VALUES ($1, $2, $3, $4, now() - $5::interval)`,
        [user, s.storyId, s.articleId, source, ago],
      );
    }

    async function trending() {
      return read.trending(NO_FILTERS, null, TRENDING_WINDOW_HOURS, 5000);
    }

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      read = new PostgresNewsReadStore(pool);
      const src = await pool.query<{ id: string }>(
        `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
         VALUES ($1, 'https://scripted.test', $2, 'rss', 'headline', 'en') RETURNING id`,
        [`Trending ${RUN}`, `https://scripted.test/trending-${RUN}.xml`],
      );
      source = src.rows[0]!.id;
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM saved_article WHERE source_id = $1`, [source]);
      const stories = await pool.query<{ story_id: string }>(
        `SELECT DISTINCT story_id FROM article WHERE source_id = $1`,
        [source],
      );
      await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
      await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [
        stories.rows.map((r) => r.story_id),
      ]);
      await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`ts_${RUN}_%`]);
      await pool.end();
    });

    it('ranks by distinct savers inside the window, and leaves out a save older than it', async () => {
      const [a, b, c] = [await member('a'), await member('b'), await member('c')];
      const popular = await story(`Saved thrice ${RUN}`);
      const quiet = await story(`Saved once ${RUN}`);
      const old = await story(`Saved long ago ${RUN}`);
      await save(a, popular);
      await save(b, popular);
      await save(c, popular);
      await save(a, quiet);
      await save(b, old, `${TRENDING_WINDOW_HOURS + 1} hours`);

      const page = await trending();
      const ours = page.cards.filter((card) =>
        [popular.storyId, quiet.storyId, old.storyId].includes(card.story_id),
      );
      expect(ours.map((card) => [card.story_id, card.discussion])).toEqual([
        [popular.storyId, { participants: 0, savers: 3, window_hours: TRENDING_WINDOW_HOURS }],
        [quiet.storyId, { participants: 0, savers: 1, window_hours: TRENDING_WINDOW_HOURS }],
      ]);
    });

    it('counts a member once when a merge moves their save onto a story they had saved', async () => {
      const [d, e] = [await member('d'), await member('e')];
      const kept = await story(`Kept story ${RUN}`);
      const merged = await story(`Merged story ${RUN}`);
      await save(d, kept);
      await save(d, merged);
      await save(e, merged);
      await new PostgresNewsStore(pool).moveToStory(merged.articleId, kept.storyId);

      const card = (await trending()).cards.find((c) => c.story_id === kept.storyId);
      expect(card?.discussion?.savers).toBe(2);
      expect((await trending()).cards.map((c) => c.story_id)).not.toContain(merged.storyId);
    });

    it('stays within its query budget over ten thousand saves', async () => {
      await pool.query(
        `WITH users AS (
           INSERT INTO user_account
             (username, display_name, email, country_id, preferred_language, timezone,
              accepted_rules_at, email_verified_at)
           SELECT $1 || n, 'Bulk ' || n, $1 || n || '@example.test', $2, 'en', 'Europe/London',
                  now(), now()
             FROM generate_series(1, $3::int) AS n
           RETURNING id
         ),
         stories AS (
           INSERT INTO story (id) SELECT gen_random_uuid() FROM generate_series(1, $4::int)
           RETURNING id
         ),
         articles AS (
           INSERT INTO article (source_id, story_id, external_id, url)
           SELECT $5::uuid, s.id, 'bulk-' || s.id, 'https://scripted.test/bulk' FROM stories s
           RETURNING id, story_id
         ),
         versions AS (
           INSERT INTO article_version (article_id, language, version_number, headline, published_at)
           SELECT a.id, 'en', 1, 'Bulk ' || a.id, now() - interval '2 hours' FROM articles a
         )
         INSERT INTO saved_article (user_id, story_id, article_id, source_id, saved_at)
         SELECT u.id, a.story_id, a.id, $5::uuid, now() - interval '3 hours'
           FROM users u CROSS JOIN articles a`,
        [`ts_${RUN}_bulk`, ENGLAND, BULK_MEMBERS, BULK_STORIES, source],
      );
      // A statement's own inserts are not visible to its other parts, so the
      // originals are promoted once the stories exist.
      await pool.query(
        `UPDATE story s SET promoted_article_id = a.id
           FROM article a
          WHERE a.story_id = s.id AND a.source_id = $1 AND a.external_id LIKE 'bulk-%'`,
        [source],
      );
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n FROM saved_article WHERE source_id = $1`,
        [source],
      );
      expect(Number(rows[0]!.n)).toBeGreaterThanOrEqual(BULK_MEMBERS * BULK_STORIES);

      let queries = 0;
      const counting = {
        query: (...args: Parameters<Pool['query']>) => {
          queries += 1;
          return (pool.query as (...a: unknown[]) => unknown)(...args);
        },
      } as unknown as Pool;
      const started = performance.now();
      const page = await new PostgresNewsReadStore(counting).trending(
        NO_FILTERS,
        null,
        TRENDING_WINDOW_HOURS,
        40,
      );
      const elapsed = performance.now() - started;
      expect(queries).toBe(QUERY_BUDGET);
      expect(elapsed).toBeLessThan(TIME_BUDGET_MS);
      expect(page.cards[0]?.discussion?.savers).toBe(BULK_MEMBERS);
    }, 120_000);
  },
);
