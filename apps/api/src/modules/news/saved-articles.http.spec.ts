import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { SavedArticlesResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { PostgresNewsStore } from './internal/news-store';
import { NewsModule } from './news.module';

/**
 * Saved articles over the real schema (T-842): a member saves a story, sees
 * it (headline and link only, D-061) newest first, saves it again without a
 * second row, removes it; another member sees none of it; a guest is a 401;
 * a story with no carried original is a 404; and a publisher dropped after
 * the save leaves a row that names them and says so -- no headline, no link;
 * and a save survives clustering merging its story into another.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('saved articles', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let kept: string;
  let dropped: string;
  const stories: string[] = [];

  async function register(username: string): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: `Member ${username}`,
        email: `${username}@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    expect(response.statusCode).toBe(201);
    return cookieValue(response.headers['set-cookie']);
  }

  async function story(sourceId: string, headline: string): Promise<string> {
    // One statement, so another spec's sweep of stories without an article
    // never sees this one empty.
    const { story_id: storyId, id: articleId } = (
      await pool.query<{ id: string; story_id: string }>(
        `WITH s AS (INSERT INTO story DEFAULT VALUES RETURNING id)
         INSERT INTO article (source_id, story_id, external_id, url)
         SELECT $1, s.id, $2, $3 FROM s RETURNING id, story_id`,
        [sourceId, `${headline}-${RUN}`, `https://saved.test/${encodeURIComponent(headline)}`],
      )
    ).rows[0]!;
    stories.push(storyId);
    await pool.query(
      `INSERT INTO article_version (article_id, language, version_number, headline, summary, published_at)
       VALUES ($1, 'en', 1, $2, 'A summary the saved list never shows.', '2026-09-20T10:00:00Z')`,
      [articleId, headline],
    );
    await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
      storyId,
      articleId,
    ]);
    return storyId;
  }

  const call = async (method: 'GET' | 'PUT' | 'DELETE', path: string, cookie?: string) =>
    app.inject({
      method,
      url: `/me/saved-articles${path}`,
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });

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

    const source = async (name: string) =>
      (
        await pool.query<{ id: string }>(
          // A licensed source has no feed, so the ingestion specs never read it.
          `INSERT INTO news_source (name, homepage_url, kind, rights, language)
           VALUES ($1, 'https://saved.test', 'licensed', 'summary', 'en') RETURNING id`,
          [name],
        )
      ).rows[0]!.id;
    kept = await source(`Kept ${RUN}`);
    dropped = await source(`Leaving ${RUN}`);
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`sv_${RUN}%`]);
    await pool.query(`DELETE FROM news_source WHERE id IN ($1, $2)`, [kept, dropped]);
    await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
    await pool.end();
    await app.close();
  });

  it('asks a guest to sign in', async () => {
    expect((await call('GET', '')).statusCode).toBe(401);
    expect((await call('PUT', `/${randomUUID()}`)).statusCode).toBe(401);
  });

  it('saves, lists newest first with headline and link only, saves twice once, and removes', async () => {
    const cookie = await register(`sv_${RUN}a`);
    const first = await story(kept, `First ${RUN}`);
    const second = await story(kept, `Second ${RUN}`);

    expect((await call('PUT', `/${first}`, cookie)).statusCode).toBe(200);
    const saved = await call('PUT', `/${second}`, cookie);
    expect(saved.statusCode).toBe(200);
    const body = saved.json<SavedArticlesResponse>();
    expect(body.saved.map((s) => s.story_id)).toEqual([second, first]);
    expect(body.saved[0]).toEqual({
      story_id: second,
      saved_at: expect.any(String),
      state: 'available',
      headline: `Second ${RUN}`,
      url: `https://saved.test/${encodeURIComponent(`Second ${RUN}`)}`,
      language: 'en',
      published_at: '2026-09-20T10:00:00.000Z',
      source: {
        id: kept,
        name: `Kept ${RUN}`,
        homepage_url: 'https://saved.test',
        dropped_at: null,
      },
    });
    expect(JSON.stringify(body)).not.toContain('A summary the saved list never shows.');

    // Saving again is not a second row.
    const again = (await call('PUT', `/${first}`, cookie)).json<SavedArticlesResponse>();
    expect(again.saved).toHaveLength(2);

    const removed = await call('DELETE', `/${first}`, cookie);
    expect(removed.statusCode).toBe(200);
    expect(removed.json<SavedArticlesResponse>().saved.map((s) => s.story_id)).toEqual([second]);
    // Removing what is not there is not an error.
    expect((await call('DELETE', `/${first}`, cookie)).statusCode).toBe(200);
  });

  it('is private: another member sees none of it', async () => {
    const cookie = await register(`sv_${RUN}b`);
    const list = (await call('GET', '', cookie)).json<SavedArticlesResponse>();
    expect(list.saved).toEqual([]);
    expect(list.limit).toBe(500);
  });

  it('answers 404 for a story with no carried original', async () => {
    const cookie = await register(`sv_${RUN}c`);
    expect((await call('PUT', `/${randomUUID()}`, cookie)).statusCode).toBe(404);
    expect((await call('PUT', '/not-an-id', cookie)).statusCode).toBe(404);
    const bare = (await pool.query<{ id: string }>(`INSERT INTO story DEFAULT VALUES RETURNING id`))
      .rows[0]!.id;
    stories.push(bare);
    expect((await call('PUT', `/${bare}`, cookie)).statusCode).toBe(404);
  });

  it('says a dropped publisher was dropped, with no headline and no link (D-061)', async () => {
    const cookie = await register(`sv_${RUN}d`);
    const leaving = await story(dropped, `Soon gone ${RUN}`);
    // Another publisher's report of the same story, so the story outlives the drop.
    await pool.query(
      `INSERT INTO article (source_id, story_id, external_id, url) VALUES ($1, $2, $3, 'https://saved.test/also')`,
      [kept, leaving, `also-${RUN}`],
    );
    expect((await call('PUT', `/${leaving}`, cookie)).statusCode).toBe(200);

    await pool.query(
      `UPDATE news_source SET dropped_at = now(), dropped_reason = 'Asked to be dropped' WHERE id = $1`,
      [dropped],
    );
    const [row] = (await call('GET', '', cookie)).json<SavedArticlesResponse>().saved;
    expect(row).toMatchObject({
      story_id: leaving,
      state: 'source_dropped',
      headline: null,
      url: null,
      source: { id: dropped, name: `Leaving ${RUN}`, homepage_url: null },
    });
    expect(row!.source.dropped_at).not.toBeNull();
    // Nobody can save it now: the story has no carried original, as on the story page.
    const other = await register(`sv_${RUN}e`);
    expect((await call('PUT', `/${leaving}`, other)).statusCode).toBe(404);
  });

  it('keeps a save when clustering merges its story into another', async () => {
    const cookie = await register(`sv_${RUN}f`);
    const both = await register(`sv_${RUN}g`);
    const merged = await story(kept, `Merged away ${RUN}`);
    const target = await story(kept, `Merged into ${RUN}`);
    await call('PUT', `/${merged}`, cookie);
    await call('PUT', `/${merged}`, both);
    await call('PUT', `/${target}`, both);

    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM article WHERE story_id = $1`,
      [merged],
    );
    await app.get(PostgresNewsStore).moveToStory(rows[0]!.id, target);

    const saved = (await call('GET', '', cookie)).json<SavedArticlesResponse>().saved;
    expect(saved.map((s) => [s.story_id, s.headline])).toEqual([[target, `Merged away ${RUN}`]]);
    // A member who had saved both keeps one row for the story that is left.
    const theirs = (await call('GET', '', both)).json<SavedArticlesResponse>().saved;
    expect(theirs.map((s) => s.story_id)).toEqual([target]);
  });
});
