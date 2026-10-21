import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_FILTERS, PostgresNewsReadStore } from './internal/news-read-store';

/**
 * The latest section read through windows (T-1450) returns exactly what the
 * unbounded read returns.
 *
 * Fourteen stories of this run are published in the last hour -- more than
 * the rows a one-card page reads, so the first window fills it -- and five
 * more at ten hours, three days, twenty days and sixty days back, one of them
 * with no publication time (ordered by its fetch). Every page size, from
 * every cursor, is read by the store as it ships and by one that reads only
 * unbounded; the two must agree card for card and on where the next page
 * begins. Whatever else the database holds takes part in both reads alike.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

/** The store with no windows: the reference every windowed read must equal. */
class UnboundedNewsReadStore extends PostgresNewsReadStore {
  protected override readonly newestWindows = [null];
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'latest news read through windows',
  () => {
    let pool: Pool;
    let source: string;
    const stories: string[] = [];
    const instants: string[] = [];

    /** A story of one report, published `ago` back (null: no publication time, fetched then). */
    async function story(headline: string, ago: string, published: boolean): Promise<void> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO story DEFAULT VALUES RETURNING id`,
      );
      const storyId = rows[0]!.id;
      const article = await pool.query<{ id: string; at: Date }>(
        `INSERT INTO article (source_id, story_id, external_id, url, fetched_at)
         VALUES ($1, $2, $3, $4, now() - $5::interval) RETURNING id, fetched_at AS at`,
        [
          source,
          storyId,
          `${headline}-${RUN}`,
          `https://windows.test/${RUN}/${stories.length}`,
          ago,
        ],
      );
      const articleId = article.rows[0]!.id;
      await pool.query(
        `INSERT INTO article_version (article_id, language, version_number, headline, summary, published_at)
         VALUES ($1, 'en', 1, $2, $3, CASE WHEN $4::boolean THEN now() - $5::interval END)`,
        [
          articleId,
          `${headline} ${RUN}`,
          `A distinct summary ${stories.length} ${RUN}.`,
          published,
          ago,
        ],
      );
      await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
        storyId,
        articleId,
      ]);
      stories.push(storyId);
      instants.push(article.rows[0]!.at.toISOString());
    }

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      const src = await pool.query<{ id: string }>(
        `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
         VALUES ($1, 'https://windows.test', $2, 'rss', 'summary', 'en') RETURNING id`,
        [`Windows ${RUN}`, `https://windows.test/${RUN}.xml`],
      );
      source = src.rows[0]!.id;
      const words = ['Keeper', 'Striker', 'Winger', 'Captain', 'Manager', 'Referee', 'Academy'];
      for (let i = 0; i < 14; i += 1) {
        await story(`${words[i % words.length]} story number ${i}`, `${i * 3 + 1} minutes`, true);
      }
      await story('Ten hours back', '10 hours', true);
      await story('Fetched five hours back, never dated', '5 hours', false);
      await story('Three days back', '3 days', true);
      await story('Twenty days back', '20 days', true);
      await story('Sixty days back', '60 days', true);
    });

    afterAll(async () => {
      await pool.query(`UPDATE story SET promoted_article_id = NULL WHERE id = ANY($1::uuid[])`, [
        stories,
      ]);
      // An article's versions go with it (D-061).
      await pool.query(`DELETE FROM article WHERE source_id = $1`, [source]);
      await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
      await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
      await pool.end();
    });

    it('agrees with the unbounded read for every page size, cursor and reader', async () => {
      // One snapshot for both reads: other specs write stories while this
      // runs, and `now()` stays the transaction's start, so the windows
      // move with neither.
      const client = await pool.connect();
      try {
        await client.query(`BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`);
        const snapshot = client as unknown as Pool;
        const windowed = new PostgresNewsReadStore(snapshot);
        const unbounded = new UnboundedNewsReadStore(snapshot);
        // Now, inside the hour, its last story, and each older one.
        const cursors = [null, ...[0, 6, 13, 14, 15, 16, 17].map((i) => instants.at(i) ?? null)];
        for (const locale of ['en', null]) {
          for (const limit of [1, 2, 5, 30]) {
            for (const before of cursors) {
              const got = await windowed.latest(NO_FILTERS, locale, before, limit);
              const want = await unbounded.latest(NO_FILTERS, locale, before, limit);
              expect(got, `limit ${limit}, before ${before}, locale ${locale}`).toEqual(want);
            }
          }
        }
      } finally {
        await client.query(`ROLLBACK`);
        client.release();
      }
    }, 120_000);

    it('still lists this run’s stories, newest first, past every window', async () => {
      const store = new PostgresNewsReadStore(pool);
      const ours = new Set(stories);
      const seen: string[] = [];
      let before: string | null = null;
      // Page back until the oldest of this run (sixty days) has been listed.
      for (let pages = 0; pages < 200 && seen.length < stories.length; pages += 1) {
        const page = await store.latest(NO_FILTERS, 'en', before, 30);
        seen.push(...page.cards.map((c) => c.story_id).filter((id) => ours.has(id)));
        if (page.nextBefore === null) break;
        before = page.nextBefore;
      }
      expect(seen).toHaveLength(stories.length);
      expect(seen.at(-1)).toBe(stories.at(-1));
    }, 120_000);
  },
);
