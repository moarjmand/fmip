import { randomUUID } from 'node:crypto';
import { readNewsCursor } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { NO_FILTERS, PostgresNewsReadStore } from './internal/news-read-store';

/**
 * The latest list mixes its sources (T-1816, D-411), over Postgres.
 *
 * Each case writes today's shape on a team of its own: a run of stories from
 * one busy source, the newest, then the others' in turn before them. A mixed
 * reader's first page has no more than three of the busy source in a row and
 * no more than 30% of it; paging on, every story is listed (nothing is lost)
 * -- when nothing changes between pages, exactly once; when a story already
 * shown is merged away or moves down, or a waiting one moves, still every
 * story. A Persian reader's list keeps the plain order. The sources are
 * Persian-language and shown to every reader but an English one (D-178,
 * D-207), so a German reader stands for every mixed one.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'latest news mixes its sources',
  () => {
    let pool: Pool;
    const sources: string[] = [];
    const stories: string[] = [];
    const teams: string[] = [];

    interface Case {
      team: string;
      ids: string[];
      busy: string;
      sourceOf: Map<string, string>;
    }

    /** One case's stories on a new team: `busy` from the first source, then `others` in turn. */
    async function scene(busy: number, others: number): Promise<Case> {
      const team = randomUUID();
      await pool.query(
        `INSERT INTO team (id, country_id, name, kind, gender) VALUES ($1, $2, $3, 'club', 'men')`,
        [team, ENGLAND, `Mixton ${teams.length} ${RUN}`],
      );
      teams.push(team);
      const ids: string[] = [];
      const sourceOf = new Map<string, string>();
      const add = async (source: string, n: number, minutesAgo: number): Promise<void> => {
        const { rows } = await pool.query<{ id: string }>(
          `INSERT INTO story DEFAULT VALUES RETURNING id`,
        );
        const storyId = rows[0]!.id;
        const article = await pool.query<{ id: string }>(
          `INSERT INTO article (source_id, story_id, external_id, url, fetched_at)
           VALUES ($1, $2, $3, $4, now() - make_interval(mins => $5)) RETURNING id`,
          [source, storyId, `mix-${storyId}`, `https://mix.test/${RUN}/${storyId}`, minutesAgo],
        );
        const articleId = article.rows[0]!.id;
        // Headlines unlike one another, so no story reads as a copy of another.
        await pool.query(
          `INSERT INTO article_version (article_id, language, version_number, headline, summary, published_at)
           VALUES ($1, 'fa', 1, $2, $3, now() - make_interval(mins => $4))`,
          [
            articleId,
            `Club ${teams.length} report ${n} ${storyId}`,
            `Summary ${storyId} of run ${RUN}.`,
            minutesAgo,
          ],
        );
        await pool.query(
          `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
          [articleId, team],
        );
        await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
          storyId,
          articleId,
        ]);
        stories.push(storyId);
        ids.push(storyId);
        sourceOf.set(storyId, source);
      };
      for (let n = 0; n < busy; n += 1) await add(sources[0]!, n, n + 1);
      for (let n = 0; n < others; n += 1) await add(sources[1 + (n % 4)]!, n, busy + 5 + n);
      return { team, ids, busy: sources[0]!, sourceOf };
    }

    const store = (): PostgresNewsReadStore => new PostgresNewsReadStore(pool);
    const latest = (c: Case, locale: string, before: string | null, limit: number) =>
      store().latest({ ...NO_FILTERS, team: c.team }, locale, before, limit);

    /** Every page from the top, `between` run after the first; the stories in the order shown. */
    async function pageAll(
      c: Case,
      limit: number,
      between: (cursor: string) => Promise<void> = async () => {},
    ): Promise<string[]> {
      const seen: string[] = [];
      let before: string | null = null;
      for (let pages = 0; pages < 100; pages += 1) {
        const page = await latest(c, 'de', before, limit);
        seen.push(...page.cards.map((card) => card.story_id));
        if (page.nextBefore === null) break;
        if (pages === 0) await between(page.nextBefore);
        before = page.nextBefore;
      }
      return seen;
    }

    async function remove(storyId: string): Promise<void> {
      await pool.query(`UPDATE story SET promoted_article_id = NULL WHERE id = $1`, [storyId]);
      await pool.query(`DELETE FROM article WHERE story_id = $1`, [storyId]);
      await pool.query(`DELETE FROM story WHERE id = $1`, [storyId]);
    }

    /**
     * Moves a story down, as an earlier original does: a new version of its
     * report dated earlier (versions are never changed, rule 5), so its first
     * publication -- the instant the list orders by -- moves back.
     */
    async function moveDown(storyId: string, minutesAgo: number): Promise<void> {
      await pool.query(
        `INSERT INTO article_version (article_id, language, version_number, headline, summary, published_at)
         SELECT v.article_id, v.language, v.version_number + 1, v.headline, v.summary,
                now() - make_interval(mins => $2)
           FROM article_version v JOIN article a ON a.id = v.article_id
          WHERE a.story_id = $1
          ORDER BY v.version_number DESC
          LIMIT 1`,
        [storyId, minutesAgo],
      );
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
    }, 60_000);

    afterAll(async () => {
      await pool.query(`UPDATE story SET promoted_article_id = NULL WHERE id = ANY($1::uuid[])`, [
        stories,
      ]);
      await pool.query(`DELETE FROM article WHERE source_id = ANY($1::uuid[])`, [sources]);
      await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
      await pool.query(`DELETE FROM news_source WHERE id = ANY($1::uuid[])`, [sources]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
      await pool.end();
    }, 60_000);

    it('breaks the busy source’s run on a mixed reader’s first page', async () => {
      const c = await scene(45, 32);
      const page = await latest(c, 'de', null, 40);
      expect(page.cards).toHaveLength(40);
      let run = 0;
      for (const card of page.cards) {
        run = card.source.id === c.busy ? run + 1 : 0;
        expect(run).toBeLessThanOrEqual(3);
      }
      // Forty-five of them were the newest: the others were pulled up past them.
      expect(page.cards.filter((card) => card.source.id === c.busy).length).toBeLessThanOrEqual(12);
      // The ones passed over wait in the cursor, at most a reach's worth.
      const cursor = readNewsCursor(page.nextBefore!)!;
      expect(cursor.waiting.length).toBeGreaterThan(0);
      expect(cursor.waiting.length).toBeLessThan(50);
      expect(cursor.waiting.every((id) => c.sourceOf.get(id) === c.busy)).toBe(true);
    }, 120_000);

    it('lists every story exactly once when nothing changes between pages', async () => {
      const c = await scene(30, 20);
      const seen = await pageAll(c, 10);
      expect(new Set(seen).size).toBe(seen.length);
      expect([...seen].sort()).toEqual([...c.ids].sort());
      // One source's stories keep their own order.
      expect(seen.filter((id) => c.sourceOf.get(id) === c.busy)).toEqual(c.ids.slice(0, 30));
    }, 120_000);

    it('loses no story when one already shown is merged away between pages', async () => {
      const c = await scene(30, 20);
      let gone = '';
      const seen = await pageAll(c, 10, async () => {
        const first = await latest(c, 'de', null, 10);
        gone = first.cards[2]!.story_id;
        await remove(gone);
      });
      const rest = c.ids.filter((id) => id !== gone);
      expect(rest.filter((id) => !seen.includes(id))).toEqual([]);
      expect(new Set(seen).size).toBe(seen.length);
    }, 120_000);

    it('loses no story when one already shown, or one waiting, moves down between pages', async () => {
      const c = await scene(30, 20);
      const seen = await pageAll(c, 10, async (cursor) => {
        const first = await latest(c, 'de', null, 10);
        await moveDown(first.cards[0]!.story_id, 500);
        const waiting = readNewsCursor(cursor)!.waiting;
        expect(waiting.length).toBeGreaterThan(0);
        await moveDown(waiting[0]!, 400);
      });
      // Every story at least once; the one shown and moved may come again, nothing else.
      expect(c.ids.filter((id) => !seen.includes(id))).toEqual([]);
      expect(seen.length - new Set(seen).size).toBeLessThanOrEqual(1);
    }, 120_000);

    it('keeps the plain order for a Persian reader, and reads a mixed cursor without loss', async () => {
      const c = await scene(12, 8);
      const page = await latest(c, 'fa', null, 10);
      expect(page.cards.map((card) => card.story_id)).toEqual(c.ids.slice(0, 10));
      expect(page.nextBefore).not.toContain('~');
      // A mixed page's cursor followed by a Persian reader: the plain order of what is left.
      const mixed = await latest(c, 'de', null, 10);
      const shown = new Set(mixed.cards.map((card) => card.story_id));
      const rest: string[] = [];
      let before = mixed.nextBefore;
      while (before !== null) {
        const next = await latest(c, 'fa', before, 10);
        rest.push(...next.cards.map((card) => card.story_id));
        before = next.nextBefore;
      }
      expect(rest).toEqual(c.ids.filter((id) => !shown.has(id)));
    }, 120_000);
  },
);
