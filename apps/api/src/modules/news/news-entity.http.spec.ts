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
 * News on the team and competition pages (T-944, D-119): the stories the
 * news boundary linked to the team or competition, newest first, from its
 * existing links; a team nobody wrote about says so; an unknown id is 404;
 * and before the feeds were ever read the list is `not_supplied`, not empty.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const TEAM = randomUUID();
const QUIET_TEAM = randomUUID();
const COMPETITION = randomUUID();

describe('entity news before the feeds were read (T-944)', () => {
  it('is not supplied with feeds_unread, never an empty list', async () => {
    const store = {
      entityExists: async () => true,
      lastFetchedAt: async () => null,
      latest: async () => {
        throw new Error('not asked before the feeds were read');
      },
    } as unknown as PostgresNewsReadStore;
    const controller = new NewsController(store, null as never, null as never, null as never);
    const id = randomUUID();
    expect(await controller.teamNews(id, undefined)).toEqual({
      entity: { type: 'team', id },
      stories: { coverage: 'not_supplied', last_updated_at: null, data: null },
      reason: 'feeds_unread',
    });
  });
});

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('entity news (T-944)', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let source: string;
  const stories: string[] = [];

  async function story(
    headline: string,
    publishedAt: string,
    links: { type: string; id: string }[],
  ): Promise<void> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO story DEFAULT VALUES RETURNING id`,
    );
    const storyId = rows[0]!.id;
    stories.push(storyId);
    const article = await pool.query<{ id: string }>(
      `INSERT INTO article (source_id, story_id, external_id, url)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        source,
        storyId,
        `${headline}-${RUN}`,
        `https://scripted.test/${encodeURIComponent(headline)}`,
      ],
    );
    const articleId = article.rows[0]!.id;
    await pool.query(
      `INSERT INTO article_version (article_id, language, version_number, headline, published_at)
       VALUES ($1, 'en', 1, $2, $3)`,
      [articleId, headline, publishedAt],
    );
    for (const link of links) {
      await pool.query(
        `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, $2, $3)`,
        [articleId, link.type, link.id],
      );
    }
    await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
      storyId,
      articleId,
    ]);
  }

  async function news(
    kind: 'teams' | 'competitions',
    id: string,
  ): Promise<{ status: number; body: EntityNewsResponse }> {
    const response = await app.inject({ method: 'GET', url: `/${kind}/${id}/news` });
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

    await pool.query(
      `INSERT INTO team (id, country_id, name, kind, gender)
       VALUES ($1, $3, $4, 'club', 'men'), ($2, $3, $5, 'club', 'men')`,
      [TEAM, QUIET_TEAM, ENGLAND, `Entityville ${RUN}`, `Hushford ${RUN}`],
    );
    await pool.query(
      `INSERT INTO competition (id, country_id, name, kind, scope, gender)
       VALUES ($1, $2, $3, 'league', 'domestic', 'men')`,
      [COMPETITION, ENGLAND, `Entity League ${RUN}`],
    );
    const src = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
       VALUES ($1, 'https://scripted.test', $2, 'rss', 'headline', 'en') RETURNING id`,
      [`Entity ${RUN}`, `https://scripted.test/entity-${RUN}.xml`],
    );
    source = src.rows[0]!.id;
    await pool.query(
      `INSERT INTO news_fetch (source_id, status, started_at, finished_at)
       VALUES ($1, 'succeeded', now() - interval '2 minutes', now() - interval '1 minute')`,
      [source],
    );
    await story(`Entityville sign a striker ${RUN}`, '2026-09-10T09:00:00Z', [
      { type: 'team', id: TEAM },
    ]);
    await story(`Entityville top the league ${RUN}`, '2026-09-12T09:00:00Z', [
      { type: 'team', id: TEAM },
      { type: 'competition', id: COMPETITION },
    ]);
    await story(`Somebody else ${RUN}`, '2026-09-13T09:00:00Z', []);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
    if (stories.length > 0) {
      await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
    }
    await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[TEAM, QUIET_TEAM]]);
    await pool.end();
    await app.close();
  });

  it("lists a team's linked stories newest first, and only those", async () => {
    const { status, body } = await news('teams', TEAM);
    expect(status).toBe(200);
    expect(body.entity).toEqual({ type: 'team', id: TEAM });
    expect(body.stories.coverage).toBe('available');
    expect(body.stories.last_updated_at).not.toBeNull();
    expect(body.reason).toBeNull();
    expect(body.stories.data?.map((c) => c.headline)).toEqual([
      `Entityville top the league ${RUN}`,
      `Entityville sign a striker ${RUN}`,
    ]);
  });

  it("lists a competition's linked stories", async () => {
    const { status, body } = await news('competitions', COMPETITION);
    expect(status).toBe(200);
    expect(body.entity).toEqual({ type: 'competition', id: COMPETITION });
    expect(body.stories.data?.map((c) => c.headline)).toEqual([
      `Entityville top the league ${RUN}`,
    ]);
    // One story (or none, once its fixed date leaves the window) is under
    // D-129's floor, so the list says it is limited and why (T-1010).
    expect(body.stories.coverage).toBe('limited');
    expect(body.coverage?.stories).toBeLessThanOrEqual(1);
    expect(body.reason).toBe(body.coverage?.stories === 1 ? 'below_floor' : 'no_carried_source');
  });

  it('says nothing links a team nobody wrote about, and 404s an unknown id', async () => {
    const quiet = await news('teams', QUIET_TEAM);
    expect(quiet.status).toBe(200);
    expect(quiet.body.stories).toMatchObject({ coverage: 'available', data: [] });
    expect(quiet.body.reason).toBe('nothing_linked');
    expect((await news('teams', randomUUID())).status).toBe(404);
    expect((await news('competitions', TEAM)).status).toBe(404);
    expect((await news('teams', 'not-a-team')).status).toBe(404);
  });
});
