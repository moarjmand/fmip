import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  BREAKING_WINDOW_HOURS,
  type BreakingListResponse,
  type BreakingNewsResponse,
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
 * The breaking mark (T-1004, D-125): only an editor marks, with a note, for
 * the stated window; a guest sees the strip; an expired mark is gone at the
 * next read with no job; clearing early takes a reason; every mark and clear
 * is an audit row with what was there before (rule 10).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('breaking mark', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let source: string;
  let storyId: string;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const editor = `bk_${RUN}e`;
  const member = `bk_${RUN}m`;

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
  const post = (path: string, username: string | null, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/admin/stories/${storyId}/${path}`,
      headers: username === null ? {} : as(username),
      payload,
    });
  const strip = async () =>
    (await app.inject({ method: 'GET', url: '/news/breaking' })).json<BreakingNewsResponse>();
  const ours = async () => (await strip()).stories.data!.find((c) => c.story_id === storyId);

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
       VALUES ($1, 'editor', $1, 'the breaking mark test')`,
      [ids.get(editor)],
    );
    const src = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
       VALUES ($1, 'https://scripted.test', $2, 'rss', 'headline', 'en') RETURNING id`,
      [`Breaking ${RUN}`, `https://scripted.test/breaking-${RUN}.xml`],
    );
    source = src.rows[0]!.id;
    const story = await pool.query<{ id: string }>(`INSERT INTO story DEFAULT VALUES RETURNING id`);
    storyId = story.rows[0]!.id;
    const article = await pool.query<{ id: string }>(
      `INSERT INTO article (source_id, story_id, external_id, url)
       VALUES ($1, $2, $3, 'https://scripted.test/sacked') RETURNING id`,
      [source, storyId, `sacked-${RUN}`],
    );
    await pool.query(
      `INSERT INTO article_version (article_id, language, version_number, headline, published_at)
       VALUES ($1, 'en', 1, $2, now())`,
      [article.rows[0]!.id, `Manager sacked ${RUN}`],
    );
    await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
      storyId,
      article.rows[0]!.id,
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
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`bk_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('lets only an editor mark, and insists on the note', async () => {
    expect((await post('breaking', null, { note: 'Sacked.' })).statusCode).toBe(401);
    expect((await post('breaking', member, { note: 'Sacked.' })).statusCode).toBe(403);
    expect((await post('breaking', editor, { note: '  ' })).statusCode).toBe(400);
    const missing = await app.inject({
      method: 'POST',
      url: '/admin/stories/00000000-0000-4000-8000-00000000dead/breaking',
      headers: as(editor),
      payload: { note: 'Sacked.' },
    });
    expect(missing.statusCode).toBe(404);
    expect(await ours()).toBeUndefined();
  });

  it('puts a marked story on the strip for everyone, for the stated window, and refuses a second mark', async () => {
    expect(
      (await post('breaking', editor, { note: 'The manager has been sacked.' })).statusCode,
    ).toBe(204);
    const card = await ours();
    expect(card?.headline).toBe(`Manager sacked ${RUN}`);
    expect(card?.breaking?.note).toBe('The manager has been sacked.');
    const window =
      new Date(card!.breaking!.ends_at).getTime() - new Date(card!.breaking!.marked_at).getTime();
    expect(window).toBe(BREAKING_WINDOW_HOURS * 60 * 60 * 1000);

    const page = (
      await app.inject({ method: 'GET', url: `/news/stories/${storyId}` })
    ).json<StoryPage>();
    expect(page.story.breaking?.note).toBe('The manager has been sacked.');

    expect((await post('breaking', editor, { note: 'Again.' })).statusCode).toBe(400);
  });

  it('clears early only with a reason, and audits the mark and the clear', async () => {
    expect((await post('breaking/clear', editor, { reason: '' })).statusCode).toBe(400);
    expect(
      (await post('breaking/clear', editor, { reason: 'Denied by the club.' })).statusCode,
    ).toBe(204);
    expect(await ours()).toBeUndefined();
    expect((await post('breaking/clear', editor, { reason: 'Twice.' })).statusCode).toBe(404);

    const audit = await pool.query<{
      action: string;
      reason: string;
      previous: Record<string, unknown> | null;
    }>(
      `SELECT action, reason, previous FROM audit_log
        WHERE target_type = 'story' AND target_id = $1 ORDER BY created_at, id`,
      [storyId],
    );
    expect(audit.rows).toMatchObject([
      { action: 'breaking.mark', reason: 'The manager has been sacked.', previous: null },
      {
        action: 'breaking.clear',
        reason: 'Denied by the club.',
        previous: { note: 'The manager has been sacked.' },
      },
    ]);
  });

  it('drops an expired mark at the next read, with no job, and lets the story be marked again', async () => {
    expect((await post('breaking', editor, { note: 'Confirmed now.' })).statusCode).toBe(204);
    expect((await ours())?.breaking?.note).toBe('Confirmed now.');
    // The window runs out: moved back on the database's own clock.
    await pool.query(
      `UPDATE story_breaking
          SET marked_at = now() - interval '7 hours', ends_at = now() - interval '1 hour'
        WHERE story_id = $1 AND cleared_at IS NULL`,
      [storyId],
    );
    expect(await ours()).toBeUndefined();
    const page = (
      await app.inject({ method: 'GET', url: `/news/stories/${storyId}` })
    ).json<StoryPage>();
    expect(page.story.breaking).toBeNull();
    expect((await post('breaking/clear', editor, { reason: 'Too late.' })).statusCode).toBe(404);

    const list = (
      await app.inject({ method: 'GET', url: '/admin/breaking', headers: as(editor) })
    ).json<BreakingListResponse>();
    // Newest mark first; the expired one was moved seven hours back.
    expect(list.marks.filter((m) => m.story_id === storyId).map((m) => m.state)).toEqual([
      'cleared',
      'expired',
    ]);

    expect((await post('breaking', editor, { note: 'Back on.' })).statusCode).toBe(204);
    expect((await ours())?.breaking?.note).toBe('Back on.');
  });
});
