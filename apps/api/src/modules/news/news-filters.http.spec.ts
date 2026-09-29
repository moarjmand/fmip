import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { NewsSectionResponse } from '@fmip/contracts';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { NewsModule } from './news.module';

/**
 * The news filters by story type, player and date (T-1003, D-124). Every
 * story here links one team that exists for this run only, so the `team`
 * filter scopes each answer to this spec's rows.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const TEAM = randomUUID();
const PLAYER = randomUUID();

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('news filters', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let source: string;
  const stories = new Map<string, string>();

  async function story(
    name: string,
    publishedAt: string,
    type: string | null,
    person = false,
  ): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO story DEFAULT VALUES RETURNING id`,
    );
    const storyId = rows[0]!.id;
    stories.set(name, storyId);
    const article = await pool.query<{ id: string }>(
      `INSERT INTO article (source_id, story_id, external_id, url)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [source, storyId, `${name}-${RUN}`, `https://scripted.test/${name}-${RUN}`],
    );
    const articleId = article.rows[0]!.id;
    await pool.query(
      `INSERT INTO article_version (article_id, language, version_number, headline, published_at)
       VALUES ($1, 'en', 1, $2, $3)`,
      [articleId, `${name} ${RUN}`, publishedAt],
    );
    await pool.query(
      `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
      [articleId, TEAM],
    );
    if (person) {
      await pool.query(
        `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, 'person', $2)`,
        [articleId, PLAYER],
      );
    }
    await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
      storyId,
      articleId,
    ]);
    if (type !== null) {
      await pool.query(
        `INSERT INTO story_label (story_id, story_type, origin, source_article_id, source_category)
         VALUES ($1, $2, 'publisher', $3, 'Spec')`,
        [storyId, type, articleId],
      );
    }
  }

  const news = async (query: string) => {
    const response = await app.inject({ method: 'GET', url: `/news?team=${TEAM}&${query}` });
    return { status: response.statusCode, body: response.json<NewsSectionResponse>() };
  };
  const names = (body: NewsSectionResponse): string[] =>
    (body.stories.data ?? []).map(
      (c) => [...stories.entries()].find(([, id]) => id === c.story_id)?.[0] ?? c.story_id,
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, NewsModule] })
      .overrideProvider(MAILER)
      .useValue(new CaptureMailer())
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });
    const src = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
       VALUES ($1, 'https://scripted.test', $2, 'rss', 'headline', 'en') RETURNING id`,
      [`Filters ${RUN}`, `https://scripted.test/filters-${RUN}.xml`],
    );
    source = src.rows[0]!.id;
    await story('signing', '2026-03-10T12:00:00Z', 'transfer');
    await story('loan', '2026-03-12T09:00:00Z', 'transfer');
    await story('hamstring', '2026-03-11T08:00:00Z', 'injury');
    await story('untyped-late', '2026-03-10T23:30:00Z', null);
    await story('untyped-early', '2026-03-01T10:00:00Z', null);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
    await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [[...stories.values()]]);
    await pool.end();
    await app.close();
  });

  it('filters by type and says how many stories it cannot place', async () => {
    const all = await news('');
    expect(all.body.untyped).toBeNull();
    expect(names(all.body)).toHaveLength(5);

    const transfers = await news('type=transfer');
    expect(transfers.status).toBe(200);
    expect(names(transfers.body)).toEqual(['loan', 'signing']);
    expect(transfers.body.filters.type).toBe('transfer');
    expect(transfers.body.untyped).toBe(2);

    // The untyped count honours every other filter, the dates included.
    const windowed = await news('type=injury&from=2026-03-05&to=2026-03-31');
    expect(names(windowed.body)).toEqual(['hamstring']);
    expect(windowed.body.untyped).toBe(1);

    const none = await news('type=interview');
    expect(none.body.stories.data).toEqual([]);
    expect(none.body.reason).toBe('no_match');
    expect(none.body.untyped).toBe(2);
  });

  it("reads dates as calendar days in the viewer's zone, against the first publication", async () => {
    // 23:30 UTC on the 10th is 03:00 on the 11th in Tehran.
    const utc = await news('from=2026-03-11&to=2026-03-11');
    expect(names(utc.body)).toEqual(['hamstring']);
    expect(utc.body.filters.time_zone).toBe('UTC');
    const tehran = await news('from=2026-03-11&to=2026-03-11&tz=Asia/Tehran');
    expect(names(tehran.body).sort()).toEqual(['hamstring', 'untyped-late']);
    expect(tehran.body.filters.time_zone).toBe('Asia/Tehran');
    const open = await news('from=2026-03-11');
    expect(names(open.body)).toEqual(['loan', 'hamstring']);
  });

  it('refuses a malformed filter, naming it', async () => {
    for (const query of [
      'type=gossip',
      'from=2026-02-30',
      'to=11-03-2026',
      'tz=Mars/Olympus_Mons',
      'from=2026-03-12&to=2026-03-11',
      'player=salah',
    ]) {
      const response = await news(query);
      expect(response.status, query).toBe(400);
    }
  });

  it('says a player filter cannot be answered before anyone is linked, then filters by the link', async () => {
    const linked = await pool.query<{ found: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM article_entity WHERE entity_type = 'person') AS found`,
    );
    if (!linked.rows[0]!.found) {
      const before = await news(`player=${PLAYER}`);
      expect(before.body.stories).toMatchObject({ coverage: 'not_supplied', data: null });
      expect(before.body.reason).toBe('persons_unlinked');
    }
    await story('brace', '2026-03-13T20:00:00Z', null, true);
    const after = await news(`player=${PLAYER}`);
    expect(after.body.stories.coverage).toBe('available');
    expect(names(after.body)).toEqual(['brace']);
    const other = await news(`player=${randomUUID()}`);
    expect(other.body.stories.data).toEqual([]);
    expect(other.body.reason).toBe('no_match');
  });
});
