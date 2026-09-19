import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FixtureNewsResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { NewsModule } from './news.module';

/**
 * Related news for a match (T-145): reports linked to the match come first,
 * then reports linked to one of its sides inside the window around kick-off;
 * a report about a side from outside the window and a report about nobody
 * are not related; a match nobody wrote about says so; an id that is not a
 * match is 404. The feeds have been read here (a fetch row is written for
 * the run), so an empty list is a fact and not the absence of one.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const HOME = randomUUID();
const AWAY = randomUUID();
const MATCH = randomUUID();
const QUIET_MATCH = randomUUID();
const KICKOFF = '2026-09-12T15:00:00Z';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('related news', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let source: string;
  const stories: string[] = [];

  async function story(
    headline: string,
    publishedAt: string,
    links: { type: string; id: string }[],
  ): Promise<string> {
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
    return storyId;
  }

  async function related(id: string): Promise<{ status: number; body: FixtureNewsResponse }> {
    const response = await app.inject({ method: 'GET', url: `/fixtures/${id}/news` });
    return { status: response.statusCode, body: response.json<FixtureNewsResponse>() };
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
      `INSERT INTO team (id, country_id, name, short_name, kind, gender)
       VALUES ($1, $3, $4, 'RNW', 'club', 'men'), ($2, $3, $5, 'RNA', 'club', 'men')`,
      [HOME, AWAY, ENGLAND, `Newsville ${RUN}`, `Quietford ${RUN}`],
    );
    await pool.query(
      `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
       VALUES ($1, $3, $4, 'Matchday 21', $5, 'finished'), ($2, $3, $4, 'Matchday 22', $5, 'scheduled')`,
      [MATCH, QUIET_MATCH, PL_2025, REGULAR_SEASON, KICKOFF],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [MATCH, HOME, AWAY],
    );
    const src = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
       VALUES ($1, 'https://scripted.test', $2, 'rss', 'headline', 'en') RETURNING id`,
      [`Related ${RUN}`, `https://scripted.test/related-${RUN}.xml`],
    );
    source = src.rows[0]!.id;
    // The feeds have been read: what makes an empty list a fact.
    await pool.query(
      `INSERT INTO news_fetch (source_id, status, started_at, finished_at)
       VALUES ($1, 'succeeded', now() - interval '2 minutes', now() - interval '1 minute')`,
      [source],
    );
    await story(`Newsville beat Quietford ${RUN}`, '2026-09-12T17:30:00Z', [
      { type: 'team', id: HOME },
      { type: 'team', id: AWAY },
      { type: 'fixture', id: MATCH },
    ]);
    await story(`Quietford name a new captain ${RUN}`, '2026-09-14T09:00:00Z', [
      { type: 'team', id: AWAY },
    ]);
    await story(`Newsville sign a keeper ${RUN}`, '2026-09-08T09:00:00Z', [
      { type: 'team', id: HOME },
    ]);
    // Outside the window: a fortnight before is not "current" for this match.
    await story(`Newsville pre-season ${RUN}`, '2026-08-28T09:00:00Z', [
      { type: 'team', id: HOME },
    ]);
    await story(`Somebody else entirely ${RUN}`, '2026-09-13T09:00:00Z', []);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
    if (stories.length > 0) {
      await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
    }
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [[MATCH, QUIET_MATCH]]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[HOME, AWAY]]);
    await pool.end();
    await app.close();
  });

  it('lists the match report first, then the sides, inside the window, and nothing else', async () => {
    const { status, body } = await related(MATCH);
    expect(status).toBe(200);
    expect(body.fixture_id).toBe(MATCH);
    expect(body.period).toEqual({
      since: '2026-09-05T15:00:00.000Z',
      until: '2026-09-15T15:00:00.000Z',
    });
    expect(body.stories.coverage).toBe('available');
    expect(body.stories.last_updated_at).not.toBeNull();
    expect(body.reason).toBeNull();
    expect(body.stories.data?.map((c) => c.headline)).toEqual([
      `Newsville beat Quietford ${RUN}`,
      `Quietford name a new captain ${RUN}`,
      `Newsville sign a keeper ${RUN}`,
    ]);
    // The same card the news page shows: the publisher, the link, the entities by id.
    const first = body.stories.data?.[0];
    expect(first?.source.name).toBe(`Related ${RUN}`);
    expect(first?.entities.map((e) => e.entity_type).sort()).toEqual(['fixture', 'team', 'team']);
  });

  it('says nothing links a match nobody wrote about, and 404s an id that is not a match', async () => {
    const quiet = await related(QUIET_MATCH);
    expect(quiet.status).toBe(200);
    expect(quiet.body.stories).toMatchObject({ coverage: 'available', data: [] });
    expect(quiet.body.reason).toBe('nothing_linked');
    expect((await related(randomUUID())).status).toBe(404);
    expect((await related('not-a-match')).status).toBe(404);
  });
});
