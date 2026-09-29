import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  STORY_LABEL_ORIGINS,
  STORY_TYPES,
  type NewsSectionResponse,
  type StoryPage,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { NewsModule } from './news.module';

/**
 * Story types (T-1001, D-123): the vocabulary is the contract's and the
 * database's at once; a story with no label says `not_supplied`; an editor's
 * label supersedes and never edits, and every one is an audit row with the
 * label it replaced (rule 10).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

/** The quoted values of a `CHECK (x IN (...))` constraint, as the database holds it. */
async function checkValues(pool: Pool, constraint: string): Promise<string[]> {
  const { rows } = await pool.query<{ def: string }>(
    `SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname = $1`,
    [constraint],
  );
  return [...(rows[0]?.def ?? '').matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('story types', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let source: string;
  let storyId: string;
  let articleId: string;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const editor = `st_${RUN}e`;
  const member = `st_${RUN}m`;

  async function register(username: string): Promise<void> {
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
  }

  const as = (username: string) => ({ cookie: `fmip_session=${cookies.get(username) ?? ''}` });
  const label = (username: string | null, payload: unknown, story = storyId) =>
    app.inject({
      method: 'POST',
      url: `/admin/stories/${story}/type`,
      headers: username === null ? {} : as(username),
      payload: payload as Record<string, unknown>,
    });
  const card = async () =>
    (await app.inject({ method: 'GET', url: '/news?section=latest' }))
      .json<NewsSectionResponse>()
      .stories.data!.find((c) => c.story_id === storyId);

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

    await register(editor);
    await register(member);
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'editor', $1, 'the story type test')`,
      [ids.get(editor)],
    );

    const src = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
       VALUES ($1, 'https://scripted.test', $2, 'rss', 'headline', 'en') RETURNING id`,
      [`Types ${RUN}`, `https://scripted.test/types-${RUN}.xml`],
    );
    source = src.rows[0]!.id;
    const story = await pool.query<{ id: string }>(`INSERT INTO story DEFAULT VALUES RETURNING id`);
    storyId = story.rows[0]!.id;
    const article = await pool.query<{ id: string }>(
      `INSERT INTO article (source_id, story_id, external_id, url)
       VALUES ($1, $2, $3, 'https://scripted.test/signing') RETURNING id`,
      [source, storyId, `signing-${RUN}`],
    );
    articleId = article.rows[0]!.id;
    await pool.query(
      `INSERT INTO article_version (article_id, language, version_number, headline, published_at)
       VALUES ($1, 'en', 1, $2, now())`,
      [articleId, `Club signs striker ${RUN}`],
    );
    await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
      storyId,
      articleId,
    ]);
  });

  afterAll(async () => {
    await withTriggersOff(pool, async (client) => {
      await client.query(`DELETE FROM audit_log WHERE target_type = 'story' AND target_id = $1`, [
        storyId,
      ]);
    });
    await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
    await pool.query(`DELETE FROM story WHERE id = $1`, [storyId]);
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`st_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('holds the same vocabulary and origins as the contract, so a new one fails here', async () => {
    expect((await checkValues(pool, 'story_label_type_known')).sort()).toEqual(
      [...STORY_TYPES].sort(),
    );
    expect((await checkValues(pool, 'story_label_origin_known')).sort()).toEqual(
      [...STORY_LABEL_ORIGINS].sort(),
    );
    await expect(
      pool.query(
        `INSERT INTO story_label (story_id, story_type, origin, labelled_by, reason)
         VALUES ($1, 'transfer', 'machine', $2, 'a model said so')`,
        [storyId, ids.get(editor)],
      ),
    ).rejects.toMatchObject({ code: '23514' });
    await expect(
      pool.query(
        `INSERT INTO story_label (story_id, story_type, origin, labelled_by, reason)
         VALUES ($1, 'gossip', 'editor', $2, 'not a blueprint type')`,
        [storyId, ids.get(editor)],
      ),
    ).rejects.toMatchObject({ code: '23514' });
  });

  it('says a story with no label has no type, never a default', async () => {
    expect((await card())?.type).toEqual({
      coverage: 'not_supplied',
      last_updated_at: null,
      data: null,
    });
  });

  it('lets only an editor or administrator label, with a known type and a reason', async () => {
    expect((await label(null, { type: 'transfer', reason: 'It is a signing.' })).statusCode).toBe(
      401,
    );
    expect((await label(member, { type: 'transfer', reason: 'It is a signing.' })).statusCode).toBe(
      403,
    );
    expect((await label(editor, { type: 'gossip', reason: 'x' })).statusCode).toBe(400);
    expect((await label(editor, { type: 'transfer', reason: '  ' })).statusCode).toBe(400);
    expect(
      (
        await label(
          editor,
          { type: 'transfer', reason: 'It is a signing.' },
          '00000000-0000-4000-8000-00000000dead',
        )
      ).statusCode,
    ).toBe(404);
    const { rows } = await pool.query(`SELECT 1 FROM story_label WHERE story_id = $1`, [storyId]);
    expect(rows).toEqual([]);
  });

  it('labels, supersedes rather than edits, refuses the same label twice, and audits each with the previous', async () => {
    expect((await label(editor, { type: 'transfer', reason: 'It is a signing.' })).statusCode).toBe(
      204,
    );
    const first = await card();
    expect(first?.type.coverage).toBe('available');
    expect(first?.type.data).toEqual({ type: 'transfer', origin: 'editor' });
    expect(first?.type.last_updated_at).not.toBeNull();

    expect(
      (await label(editor, { type: 'transfer', reason: 'Again.' })).statusCode,
      'the same editor label is not re-noted silently',
    ).toBe(400);

    expect(
      (await label(editor, { type: 'interview', reason: 'It is his first interview.' })).statusCode,
    ).toBe(204);
    const page = (
      await app.inject({ method: 'GET', url: `/news/stories/${storyId}` })
    ).json<StoryPage>();
    expect(page.story.type.data).toEqual({ type: 'interview', origin: 'editor' });

    const labels = await pool.query<{ story_type: string; superseded: boolean }>(
      `SELECT story_type, superseded_at IS NOT NULL AS superseded
         FROM story_label WHERE story_id = $1 ORDER BY created_at, id`,
      [storyId],
    );
    expect(labels.rows).toEqual([
      { story_type: 'transfer', superseded: true },
      { story_type: 'interview', superseded: false },
    ]);

    const audit = await pool.query<{
      actor_id: string;
      reason: string;
      previous: { type: string; origin: string } | null;
      next: { type: string; origin: string };
    }>(
      `SELECT actor_id, reason, previous, next FROM audit_log
        WHERE action = 'story.type' AND target_type = 'story' AND target_id = $1
        ORDER BY created_at, id`,
      [storyId],
    );
    expect(audit.rows).toMatchObject([
      {
        actor_id: ids.get(editor),
        reason: 'It is a signing.',
        previous: null,
        next: { type: 'transfer', origin: 'editor' },
      },
      {
        reason: 'It is his first interview.',
        previous: { type: 'transfer', origin: 'editor' },
        next: { type: 'interview', origin: 'editor' },
      },
    ]);
  });

  it('refuses to edit a label, and keeps one current label per story', async () => {
    await expect(
      pool.query(
        `UPDATE story_label SET story_type = 'opinion' WHERE story_id = $1 AND superseded_at IS NULL`,
        [storyId],
      ),
    ).rejects.toMatchObject({ code: '23001' });
    await expect(
      pool.query(
        `UPDATE story_label SET superseded_at = now() WHERE story_id = $1 AND superseded_at IS NOT NULL`,
        [storyId],
      ),
    ).rejects.toMatchObject({ code: '23001' });
    await expect(
      pool.query(
        `INSERT INTO story_label (story_id, story_type, origin, labelled_by, reason)
         VALUES ($1, 'opinion', 'editor', $2, 'a second current label')`,
        [storyId, ids.get(editor)],
      ),
    ).rejects.toMatchObject({ code: '23505' });
  });
});
