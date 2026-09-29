import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { EntityNewsResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import type { PostgresNewsReadStore } from './internal/news-read-store';
import { NewsController } from './news.controller';
import { NewsModule } from './news.module';

/**
 * News on the player page (T-1007, D-127): the stories linked to the person
 * (D-126), newest first, in the entity-news shape of D-119. Before the feeds
 * were read it is `not_supplied` with `feeds_unread`; while no story links
 * any person at all it is `not_supplied` with `persons_unlinked`, never an
 * empty list that says nobody wrote about the player.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const PLAYER = randomUUID();
const QUIET = randomUUID();

describe('player news before anything could be linked (T-1007)', () => {
  const controller = (read: Partial<PostgresNewsReadStore>) =>
    new NewsController(read as PostgresNewsReadStore, null as never, null as never, null as never);
  const unasked = async () => {
    throw new Error('not asked');
  };

  it('is feeds_unread before the feeds were read', async () => {
    const id = randomUUID();
    const body = await controller({
      entityExists: async () => true,
      lastFetchedAt: async () => null,
      anyPersonLinked: unasked,
      forPerson: unasked,
    }).playerNews(id, undefined);
    expect(body).toEqual({
      entity: { type: 'person', id },
      stories: { coverage: 'not_supplied', last_updated_at: null, data: null },
      reason: 'feeds_unread',
    });
  });

  it('is persons_unlinked while no story links any person', async () => {
    const id = randomUUID();
    const body = await controller({
      entityExists: async () => true,
      lastFetchedAt: async () => '2026-09-29T10:00:00.000Z',
      anyPersonLinked: async () => false,
      forPerson: unasked,
    }).playerNews(id, undefined);
    expect(body).toEqual({
      entity: { type: 'person', id },
      stories: {
        coverage: 'not_supplied',
        last_updated_at: '2026-09-29T10:00:00.000Z',
        data: null,
      },
      reason: 'persons_unlinked',
    });
  });
});

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('player news (T-1007)', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let source: string;
  const stories: string[] = [];

  async function story(headline: string, publishedAt: string, person: string | null) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO story DEFAULT VALUES RETURNING id`,
    );
    const storyId = rows[0]!.id;
    stories.push(storyId);
    const article = await pool.query<{ id: string }>(
      `INSERT INTO article (source_id, story_id, external_id, url)
       VALUES ($1, $2, $3, 'https://scripted.test/player') RETURNING id`,
      [source, storyId, `${headline}-${RUN}`],
    );
    const articleId = article.rows[0]!.id;
    await pool.query(
      `INSERT INTO article_version (article_id, language, version_number, headline, published_at)
       VALUES ($1, 'en', 1, $2, $3)`,
      [articleId, headline, publishedAt],
    );
    if (person !== null) {
      await pool.query(
        `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, 'person', $2)`,
        [articleId, person],
      );
    }
    await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
      storyId,
      articleId,
    ]);
  }

  async function news(id: string): Promise<{ status: number; body: EntityNewsResponse }> {
    const response = await app.inject({ method: 'GET', url: `/players/${id}/news` });
    return { status: response.statusCode, body: response.json<EntityNewsResponse>() };
  }

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

    await pool.query(`INSERT INTO person (id, full_name) VALUES ($1, $3), ($2, $4)`, [
      PLAYER,
      QUIET,
      `Newsy Player ${RUN}`,
      `Quiet Player ${RUN}`,
    ]);
    const src = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
       VALUES ($1, 'https://scripted.test', $2, 'rss', 'headline', 'en') RETURNING id`,
      [`Player ${RUN}`, `https://scripted.test/player-${RUN}.xml`],
    );
    source = src.rows[0]!.id;
    await pool.query(
      `INSERT INTO news_fetch (source_id, status, started_at, finished_at)
       VALUES ($1, 'succeeded', now() - interval '2 minutes', now() - interval '1 minute')`,
      [source],
    );
    await story(`Newsy signs on ${RUN}`, '2026-09-10T09:00:00Z', PLAYER);
    await story(`Newsy scores ${RUN}`, '2026-09-12T09:00:00Z', PLAYER);
    await story(`Someone else ${RUN}`, '2026-09-13T09:00:00Z', null);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
    if (stories.length > 0) {
      await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
    }
    await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [[PLAYER, QUIET]]);
    await pool.end();
    await app.close();
  });

  it("lists the player's linked stories newest first, and only those", async () => {
    const { status, body } = await news(PLAYER);
    expect(status).toBe(200);
    expect(body.entity).toEqual({ type: 'person', id: PLAYER });
    expect(body.stories.coverage).toBe('available');
    expect(body.reason).toBeNull();
    expect(body.stories.data?.map((c) => c.headline)).toEqual([
      `Newsy scores ${RUN}`,
      `Newsy signs on ${RUN}`,
    ]);
  });

  it('says nothing links a player nobody wrote about once links exist, and 404s an unknown id', async () => {
    const quiet = await news(QUIET);
    expect(quiet.status).toBe(200);
    expect(quiet.body.stories).toMatchObject({ coverage: 'available', data: [] });
    expect(quiet.body.reason).toBe('nothing_linked');
    expect((await news(randomUUID())).status).toBe(404);
    expect((await news('not-a-player')).status).toBe(404);
  });
});
