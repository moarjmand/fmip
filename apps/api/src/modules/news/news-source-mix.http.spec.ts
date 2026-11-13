import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_FILTERS, PostgresNewsReadStore } from './internal/news-read-store';

/**
 * The latest list mixes its sources (T-1816, D-411), over Postgres.
 *
 * This run writes today's shape: forty-five stories from one busy source in
 * the last hour, the newest, then eight from each of four others before them.
 * An English reader's first page has no more than three of the busy source in
 * a row and no more than 30% of it; paging on, every story is listed exactly
 * once (nothing is left out, nothing repeats). A Persian reader's list keeps
 * the plain order. The sources are Persian-language and shown to every reader
 * but an English one (D-178, D-207), so a German reader stands for every
 * mixed one. Whatever else the database holds takes part alike.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'latest news mixes its sources',
  () => {
    let pool: Pool;
    const sources: string[] = [];
    const stories: string[] = [];
    /** Story id -> its source's index in `sources`. */
    const sourceOf = new Map<string, number>();

    async function story(source: number, n: number, minutesAgo: number): Promise<void> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO story DEFAULT VALUES RETURNING id`,
      );
      const storyId = rows[0]!.id;
      const article = await pool.query<{ id: string }>(
        `INSERT INTO article (source_id, story_id, external_id, url, fetched_at)
         VALUES ($1, $2, $3, $4, now() - make_interval(mins => $5)) RETURNING id`,
        [
          sources[source],
          storyId,
          `mix-${source}-${n}-${RUN}`,
          `https://mix.test/${RUN}/${source}/${n}`,
          minutesAgo,
        ],
      );
      const articleId = article.rows[0]!.id;
      // Headlines unlike one another, so no story reads as a copy of another.
      await pool.query(
        `INSERT INTO article_version (article_id, language, version_number, headline, summary, published_at)
         VALUES ($1, 'fa', 1, $2, $3, now() - make_interval(mins => $4))`,
        [
          articleId,
          `Club ${source} report ${n} ${RUN} ${'qwertyuiop'.slice(0, (n % 9) + 1)}`,
          `Summary ${source}/${n} of run ${RUN}.`,
          minutesAgo,
        ],
      );
      await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
        storyId,
        articleId,
      ]);
      stories.push(storyId);
      sourceOf.set(storyId, source);
    }

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      for (let s = 0; s < 5; s += 1) {
        const src = await pool.query<{ id: string }>(
          `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
           VALUES ($1, 'https://mix.test', $2, 'rss', 'summary', 'fa') RETURNING id`,
          [`Mix ${s} ${RUN}`, `https://mix.test/${RUN}/${s}.xml`],
        );
        sources.push(src.rows[0]!.id);
      }
      // Source 0 is the busy one: the newest forty-five, a minute apart.
      for (let n = 0; n < 45; n += 1) await story(0, n, n + 1);
      // Then four others, in turn, older.
      for (let n = 0; n < 32; n += 1) await story(1 + (n % 4), n, 50 + n);
    }, 120_000);

    afterAll(async () => {
      await pool.query(`UPDATE story SET promoted_article_id = NULL WHERE id = ANY($1::uuid[])`, [
        stories,
      ]);
      await pool.query(`DELETE FROM article WHERE source_id = ANY($1::uuid[])`, [sources]);
      await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
      await pool.query(`DELETE FROM news_source WHERE id = ANY($1::uuid[])`, [sources]);
      await pool.end();
    }, 60_000);

    it('breaks the busy source’s run on a mixed reader’s first page', async () => {
      const store = new PostgresNewsReadStore(pool);
      const page = await store.latest(NO_FILTERS, 'de', null, 40);
      const busy = page.cards.map((c) => c.source.id === sources[0]);
      let run = 0;
      for (const b of busy) {
        run = b ? run + 1 : 0;
        expect(run).toBeLessThanOrEqual(3);
      }
      // Forty-five of them were the newest: the others were pulled up past them.
      expect(busy.filter(Boolean).length).toBeLessThanOrEqual(12);
      expect(page.nextBefore).not.toBeNull();
    });

    it('lists every story exactly once, page after page', async () => {
      const store = new PostgresNewsReadStore(pool);
      const seen: string[] = [];
      let before: string | null = null;
      for (let pages = 0; pages < 500; pages += 1) {
        const page = await store.latest(NO_FILTERS, 'de', before, 10);
        seen.push(...page.cards.map((c) => c.story_id));
        if (stories.every((id) => seen.includes(id)) || page.nextBefore === null) break;
        before = page.nextBefore;
      }
      expect(new Set(seen).size).toBe(seen.length);
      expect(stories.filter((id) => !seen.includes(id))).toEqual([]);
      // One source's stories keep their own order.
      const busy = seen.filter((id) => sourceOf.get(id) === 0);
      expect(busy).toEqual(stories.slice(0, 45));
    }, 120_000);

    it('keeps the plain order for a Persian reader', async () => {
      const store = new PostgresNewsReadStore(pool);
      const page = await store.latest(NO_FILTERS, 'fa', null, 40);
      const ours = page.cards.map((c) => c.story_id).filter((id) => sourceOf.has(id));
      expect(ours.length).toBeGreaterThan(0);
      expect(ours.every((id) => sourceOf.get(id) === 0)).toBe(true);
      expect(page.nextBefore).not.toContain('~');
    });
  },
);
