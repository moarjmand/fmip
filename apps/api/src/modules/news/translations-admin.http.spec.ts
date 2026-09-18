import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { StoryPage } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { NewsModule } from './news.module';

/**
 * A person's language version of an article (T-304): written as a new
 * version by an editor, read back on the story page with whose words it is,
 * reviewed by a second person as another new version and refused to the
 * author; refused into the publisher's own language and refused a summary
 * the source does not grant; every decision an audit row.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('article translations', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const sources: string[] = [];
  let storyId = '';
  let articleId = '';
  let headlineOnlyArticle = '';
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();

  async function register(username: string, role: 'editor' | null): Promise<void> {
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
    cookies.set(username, cookieValue(response.headers['set-cookie']));
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
      [username],
    );
    ids.set(username, rows[0]!.id);
    if (role !== null) {
      await pool.query(
        `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, $2, $1, 'the translation test')`,
        [rows[0]!.id, role],
      );
    }
  }

  const as = (username: string) => ({ cookie: `fmip_session=${cookies.get(username) ?? ''}` });
  const translate = (who: string, article: string, payload: unknown) =>
    app.inject({
      method: 'POST',
      url: `/admin/articles/${article}/translations`,
      headers: as(who),
      payload,
    });
  const review = (who: string, article: string, language: string) =>
    app.inject({
      method: 'POST',
      url: `/admin/articles/${article}/translations/${language}/review`,
      headers: as(who),
    });
  const story = async (language: string | null): Promise<StoryPage> =>
    (
      await app.inject({
        method: 'GET',
        url: `/news/stories/${storyId}${language === null ? '' : `?language=${language}`}`,
      })
    ).json<StoryPage>();

  async function article(
    rights: 'summary' | 'headline',
  ): Promise<{ story: string; article: string }> {
    const src = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
       VALUES ($1, 'https://scripted.test', $2, 'rss', $3, 'en') RETURNING id`,
      [`Translated ${rights} ${RUN}`, `https://scripted.test/${rights}-${RUN}.xml`, rights],
    );
    sources.push(src.rows[0]!.id);
    const st = await pool.query<{ id: string }>(`INSERT INTO story DEFAULT VALUES RETURNING id`);
    const art = await pool.query<{ id: string }>(
      `INSERT INTO article (source_id, story_id, external_id, url)
       VALUES ($1, $2, $3, 'https://scripted.test/derby') RETURNING id`,
      [src.rows[0]!.id, st.rows[0]!.id, `derby-${rights}-${RUN}`],
    );
    await pool.query(
      `INSERT INTO article_version (article_id, language, version_number, headline, summary, published_at)
       VALUES ($1, 'en', 1, $2, $3, '2026-09-18T10:00:00Z')`,
      [
        art.rows[0]!.id,
        `Derby settled late ${RUN}`,
        rights === 'summary' ? 'A late header settled it.' : null,
      ],
    );
    await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
      st.rows[0]!.id,
      art.rows[0]!.id,
    ]);
    return { story: st.rows[0]!.id, article: art.rows[0]!.id };
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
    await register(`tl_${RUN}a`, 'editor');
    await register(`tl_${RUN}b`, 'editor');
    await register(`tl_${RUN}m`, null);
    const main = await article('summary');
    storyId = main.story;
    articleId = main.article;
    headlineOnlyArticle = (await article('headline')).article;
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(
        `DELETE FROM audit_log WHERE target_type = 'article' AND target_id IN ($1, $2)`,
        [articleId, headlineOnlyArticle],
      );
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM news_source WHERE id = ANY($1::uuid[])`, [sources]);
    await pool.query(
      `DELETE FROM story s WHERE NOT EXISTS (SELECT 1 FROM article a WHERE a.story_id = s.id)`,
    );
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`tl_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('is written by an editor as a new version and read back as a translation awaiting review', async () => {
    expect(
      (await translate(`tl_${RUN}m`, articleId, { language: 'fa', headline: 'x' })).statusCode,
    ).toBe(403);
    const guest = await app.inject({
      method: 'POST',
      url: `/admin/articles/${articleId}/translations`,
      payload: { language: 'fa', headline: 'x' },
    });
    expect(guest.statusCode).toBe(401);

    const written = await translate(`tl_${RUN}a`, articleId, {
      language: 'fa',
      headline: `دربی در دقایق پایانی ${RUN}`,
      summary: 'یک ضربه سر دیرهنگام کار را تمام کرد.',
    });
    expect(written.statusCode).toBe(201);
    expect(written.json()).toEqual({ version_number: 1 });

    const page = await story('fa');
    expect(page.story).toMatchObject({
      language: 'fa',
      headline: `دربی در دقایق پایانی ${RUN}`,
      origin: 'translation',
      review_state: 'translated',
    });
    expect(page.versions).toEqual([
      expect.objectContaining({ language: 'en', origin: 'publisher', review_state: null }),
      expect.objectContaining({
        language: 'fa',
        origin: 'translation',
        review_state: 'translated',
      }),
    ]);
    // The default is still the publisher's own words.
    expect((await story(null)).story).toMatchObject({ language: 'en', origin: 'publisher' });
  });

  it('is reviewed by a second person as another version, never by its author', async () => {
    expect((await review(`tl_${RUN}a`, articleId, 'fa')).statusCode).toBe(400);
    expect((await review(`tl_${RUN}b`, articleId, 'de')).statusCode).toBe(404);
    expect((await review(`tl_${RUN}b`, articleId, 'fa')).statusCode).toBe(204);
    expect((await review(`tl_${RUN}b`, articleId, 'fa')).statusCode).toBe(400);

    const page = await story('fa');
    expect(page.story).toMatchObject({ origin: 'translation', review_state: 'reviewed' });
    expect(page.versions.find((v) => v.language === 'fa')).toMatchObject({
      version_number: 2,
      review_state: 'reviewed',
    });
    const versions = await pool.query<{
      version_number: number;
      written_by: string;
      reviewed_by: string | null;
    }>(
      `SELECT version_number, written_by, reviewed_by FROM article_version
        WHERE article_id = $1 AND language = 'fa' ORDER BY version_number`,
      [articleId],
    );
    expect(versions.rows).toEqual([
      { version_number: 1, written_by: ids.get(`tl_${RUN}a`), reviewed_by: null },
      { version_number: 2, written_by: ids.get(`tl_${RUN}a`), reviewed_by: ids.get(`tl_${RUN}b`) },
    ]);
    const audit = await pool.query<{ action: string; actor_id: string }>(
      `SELECT action, actor_id FROM audit_log WHERE target_type = 'article' AND target_id = $1 ORDER BY created_at`,
      [articleId],
    );
    expect(audit.rows).toEqual([
      { action: 'translation.write', actor_id: ids.get(`tl_${RUN}a`) },
      { action: 'translation.review', actor_id: ids.get(`tl_${RUN}b`) },
    ]);
  });

  it("refuses a translation into the publisher's own language, and a summary the source does not grant", async () => {
    const second = await translate(`tl_${RUN}a`, articleId, { language: 'en', headline: 'Derby' });
    expect(second.statusCode).toBe(400);
    expect(second.json<{ message: string }>().message).toMatch(/already writes/);

    const tooMuch = await translate(`tl_${RUN}a`, headlineOnlyArticle, {
      language: 'fa',
      headline: 'دربی',
      summary: 'a summary the source never granted',
    });
    expect(tooMuch.statusCode).toBe(400);
    expect(tooMuch.json<{ message: string }>().message).toMatch(/headline only/);
    // Without the summary it is what the source grants, and it is written.
    const justHeadline = await translate(`tl_${RUN}a`, headlineOnlyArticle, {
      language: 'fa',
      headline: 'دربی',
    });
    expect(justHeadline.statusCode).toBe(201);

    expect(
      (await translate(`tl_${RUN}a`, articleId, { language: 'not a tag', headline: 'x' }))
        .statusCode,
    ).toBe(400);
    expect(
      (await translate(`tl_${RUN}a`, articleId, { language: 'de', headline: '  ' })).statusCode,
    ).toBe(400);
  });
});
