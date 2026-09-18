import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * The article schema, against the real database (T-141, D-061).
 *
 * Nothing in the API reads or writes these yet -- ingestion is T-142 and the
 * page is T-144 -- so this writes what they will write and checks the
 * guarantees that belong to the database rather than to any caller:
 *
 * - **rights live on the source**: a version that carries more than its
 *   source grants is refused at the write (PL016), not by a renderer;
 * - an article links to its football **by UUID**, never by name (rule 1);
 * - a version is immutable and a change is a new version;
 * - a correction is immutable and dated;
 * - a source that goes away takes its own articles and nothing else.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

interface Codeful {
  code?: string;
  constraint?: string;
  hint?: string;
}
const sqlstate = (error: unknown): string | undefined => (error as Codeful).code;
const constraintOf = (error: unknown): string | undefined => (error as Codeful).constraint;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('article schema', () => {
  let pool: Pool;
  const sources: string[] = [];
  let team = '';

  async function source(rights: 'headline' | 'summary' | 'full_text'): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
       VALUES ($1, 'https://example.test', 'https://example.test/feed', 'rss', $2, 'en')
       RETURNING id`,
      [`Source ${rights} ${RUN}`, rights],
    );
    const id = rows[0]?.id ?? '';
    sources.push(id);
    return id;
  }

  async function article(sourceId: string, externalId = `item-${RUN}-${Math.random()}`) {
    const story = await pool.query<{ id: string }>(`INSERT INTO story DEFAULT VALUES RETURNING id`);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO article (source_id, story_id, external_id, url)
       VALUES ($1, $2, $3, 'https://example.test/story')
       RETURNING id`,
      [sourceId, story.rows[0]?.id, externalId],
    );
    return { id: rows[0]?.id ?? '', story: story.rows[0]?.id ?? '' };
  }

  const version = (
    articleId: string,
    fields: { summary?: string | null; body?: string | null; number?: number; language?: string },
  ) =>
    pool.query(
      `INSERT INTO article_version (article_id, language, version_number, headline, summary, body, published_at)
       VALUES ($1, $2, $3, 'A headline', $4, $5, now())`,
      [
        articleId,
        fields.language ?? 'en',
        fields.number ?? 1,
        fields.summary ?? null,
        fields.body ?? null,
      ],
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO team (name, short_name, code, kind, gender, age_group, country_id)
       VALUES ($1, 'NWS', 'NWS', 'club', 'men', 'senior', $2) RETURNING id`,
      [`News Schema Team ${RUN}`, ENGLAND],
    );
    team = rows[0]?.id ?? '';
  });

  afterAll(async () => {
    // Sources cascade to articles, versions, links and corrections; stories are
    // left by design (RESTRICT), so they go by hand after their articles.
    if (sources.length > 0) {
      await pool.query(`DELETE FROM news_source WHERE id = ANY($1::uuid[])`, [sources]);
    }
    await pool.query(
      `DELETE FROM story WHERE NOT EXISTS (SELECT 1 FROM article a WHERE a.story_id = story.id)`,
    );
    if (team !== '') await pool.query(`DELETE FROM team WHERE id = $1`, [team]);
    await pool.end();
  });

  describe('rights live on the source (D-061)', () => {
    it('refuses a summary on a source that grants the headline only', async () => {
      const { id } = await article(await source('headline'));
      await expect(version(id, { summary: 'A summary' })).rejects.toSatisfy((error: unknown) => {
        expect(sqlstate(error)).toBe('PL016');
        expect((error as Codeful).hint).toBe('news_source.rights = headline');
        return true;
      });
      // The headline alone is what that source grants, and it is accepted.
      await expect(version(id, {})).resolves.toBeDefined();
    });

    it('refuses a body on a source that grants the summary, and accepts the summary', async () => {
      const { id } = await article(await source('summary'));
      await expect(version(id, { body: 'The whole piece' })).rejects.toSatisfy((error: unknown) => {
        expect(sqlstate(error)).toBe('PL016');
        expect((error as Codeful).hint).toBe('news_source.rights = summary');
        return true;
      });
      await expect(version(id, { summary: 'What the publisher wrote' })).resolves.toBeDefined();
    });

    it('accepts the full text where a source grants it -- the licensed case, built in now', async () => {
      const { id } = await article(await source('full_text'));
      await expect(
        version(id, { summary: 'A summary', body: 'The whole piece' }),
      ).resolves.toBeDefined();
    });

    it('will not let a feed source exist without a feed, or be dropped without a reason', async () => {
      await expect(
        pool.query(
          `INSERT INTO news_source (name, homepage_url, kind, rights, language)
           VALUES ('Feedless', 'https://x.test', 'rss', 'headline', 'en')`,
        ),
      ).rejects.toSatisfy((error: unknown) => {
        expect(constraintOf(error)).toBe('news_source_feed_for_feed_kinds');
        return true;
      });
      const id = await source('headline');
      await expect(
        pool.query(`UPDATE news_source SET dropped_at = now() WHERE id = $1`, [id]),
      ).rejects.toSatisfy((error: unknown) => {
        expect(constraintOf(error)).toBe('news_source_dropped_is_whole');
        return true;
      });
      await expect(
        pool.query(
          `UPDATE news_source SET dropped_at = now(), dropped_reason = 'asked to be removed' WHERE id = $1`,
          [id],
        ),
      ).resolves.toBeDefined();
    });
  });

  describe('one canonical article, versions per language', () => {
    it('keeps a version immutable: a change is a new version, and a delete on its own is refused', async () => {
      const { id } = await article(await source('summary'));
      await version(id, { summary: 'First' });
      await expect(
        pool.query(`UPDATE article_version SET headline = 'Edited' WHERE article_id = $1`, [id]),
      ).rejects.toSatisfy((error: unknown) => {
        expect(sqlstate(error)).toBe('23001');
        return true;
      });
      // A version goes only with its article (D-061); never on its own.
      await expect(
        pool.query(`DELETE FROM article_version WHERE article_id = $1`, [id]),
      ).rejects.toSatisfy((error: unknown) => {
        expect(sqlstate(error)).toBe('23001');
        return true;
      });
      await expect(version(id, { summary: 'Second', number: 2 })).resolves.toBeDefined();
      const { rows } = await pool.query<{ n: string }>(
        `SELECT count(*) AS n FROM article_version WHERE article_id = $1`,
        [id],
      );
      expect(rows[0]?.n).toBe('2');
    });

    it('holds one version per language per number, and a second language beside it', async () => {
      const { id } = await article(await source('headline'));
      await version(id, {});
      await expect(version(id, {})).rejects.toSatisfy((error: unknown) => {
        expect(constraintOf(error)).toBe('article_version_unique');
        return true;
      });
      await expect(version(id, { language: 'ar' })).resolves.toBeDefined();
    });

    it('writes an item once per source, by the identity its feed gave it', async () => {
      const s = await source('headline');
      await article(s, `guid-${RUN}`);
      await expect(article(s, `guid-${RUN}`)).rejects.toSatisfy((error: unknown) => {
        expect(constraintOf(error)).toBe('article_external_id_per_source');
        return true;
      });
    });
  });

  describe('links to the football, by id (rule 1)', () => {
    it('links a team by its UUID, once, and refuses a kind of thing that is not football', async () => {
      const { id } = await article(await source('headline'));
      await pool.query(
        `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
        [id, team],
      );
      await expect(
        pool.query(
          `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
          [id, team],
        ),
      ).rejects.toSatisfy((error: unknown) => {
        expect(sqlstate(error)).toBe('23505');
        return true;
      });
      await expect(
        pool.query(
          `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, 'sponsor', $2)`,
          [id, team],
        ),
      ).rejects.toSatisfy((error: unknown) => {
        expect(constraintOf(error)).toBe('article_entity_type_check');
        return true;
      });
    });

    it('has no column for a name anywhere in the link', async () => {
      const { rows } = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns WHERE table_name = 'article_entity' ORDER BY 1`,
      );
      expect(rows.map((r) => r.column_name)).toEqual(['article_id', 'entity_id', 'entity_type']);
    });
  });

  describe('corrections and what goes when a source goes', () => {
    it('keeps a correction immutable and dated', async () => {
      const { id } = await article(await source('headline'));
      await pool.query(
        `INSERT INTO article_correction (article_id, note) VALUES ($1, 'The score was 2-1, not 2-0.')`,
        [id],
      );
      await expect(
        pool.query(`DELETE FROM article_correction WHERE article_id = $1`, [id]),
      ).rejects.toSatisfy((error: unknown) => {
        expect(sqlstate(error)).toBe('23001');
        return true;
      });
    });

    it('takes a dropped source’s own articles with it, and nothing else', async () => {
      const gone = await source('summary');
      const stays = await source('summary');
      const a = await article(gone);
      const b = await article(stays);
      await version(a.id, { summary: 'Going' });
      await version(b.id, { summary: 'Staying' });
      await pool.query(
        `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, 'team', $2), ($3, 'team', $2)`,
        [a.id, team, b.id],
      );
      await pool.query(`DELETE FROM news_source WHERE id = $1`, [gone]);
      sources.splice(sources.indexOf(gone), 1);
      const { rows } = await pool.query<{ what: string; n: string }>(
        `SELECT 'articles' AS what, count(*)::text AS n FROM article WHERE id IN ($1, $2)
         UNION ALL SELECT 'versions', count(*)::text FROM article_version WHERE article_id IN ($1, $2)
         UNION ALL SELECT 'links', count(*)::text FROM article_entity WHERE article_id IN ($1, $2)
         UNION ALL SELECT 'teams', count(*)::text FROM team WHERE id = $3`,
        [a.id, b.id, team],
      );
      expect(Object.fromEntries(rows.map((r) => [r.what, r.n]))).toEqual({
        articles: '1',
        versions: '1',
        links: '1',
        teams: '1',
      });
    });

    it('lets a publisher who asks to be dropped take their words with them, and keeps the reason', async () => {
      const dropped = await source('summary');
      const { id } = await article(dropped);
      await version(id, { summary: 'Their words' });
      await pool.query(`INSERT INTO article_correction (article_id, note) VALUES ($1, 'A note')`, [
        id,
      ]);
      await pool.query(
        `UPDATE news_source SET dropped_at = now(), dropped_reason = 'the publisher asked' WHERE id = $1`,
        [dropped],
      );
      const { rows } = await pool.query<{
        articles: string;
        source_name: string | null;
        reason: string | null;
      }>(
        `SELECT (SELECT count(*)::text FROM article WHERE source_id = $1) AS articles,
                (SELECT name FROM news_source WHERE id = $1) AS source_name,
                (SELECT dropped_reason FROM news_source WHERE id = $1) AS reason`,
        [dropped],
      );
      // The items are gone; the source row stays as the answer to "why is X not here".
      expect(rows[0]?.articles).toBe('0');
      expect(rows[0]?.source_name).toContain('Source summary');
      expect(rows[0]?.reason).toBe('the publisher asked');
    });
  });
});
