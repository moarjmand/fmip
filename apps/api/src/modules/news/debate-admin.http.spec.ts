import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { DebateListResponse, NewsSectionResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { NewsModule } from './news.module';

/**
 * The editor's half of the debate section (T-143, rule 10): only an editor or
 * an administrator selects; a selection needs a note and lands on the public
 * section with it; selecting twice is refused rather than re-noted; clearing
 * needs a reason and leaves the record; every decision is an audit row with
 * the actor, the reason and what was there before.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('debate selection', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let source: string;
  let storyId: string;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();

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

    await register(`db_${RUN}e`);
    await register(`db_${RUN}m`);
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'editor', $1, 'the debate selection test')`,
      [ids.get(`db_${RUN}e`)],
    );

    const src = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
       VALUES ($1, 'https://scripted.test', $2, 'rss', 'headline', 'en') RETURNING id`,
      [`Debate ${RUN}`, `https://scripted.test/debate-${RUN}.xml`],
    );
    source = src.rows[0]!.id;
    const story = await pool.query<{ id: string }>(`INSERT INTO story DEFAULT VALUES RETURNING id`);
    storyId = story.rows[0]!.id;
    const article = await pool.query<{ id: string }>(
      `INSERT INTO article (source_id, story_id, external_id, url)
       VALUES ($1, $2, $3, 'https://scripted.test/penalty') RETURNING id`,
      [source, storyId, `penalty-${RUN}`],
    );
    await pool.query(
      `INSERT INTO article_version (article_id, language, version_number, headline, published_at)
       VALUES ($1, 'en', 1, $2, '2026-09-18T10:00:00Z')`,
      [article.rows[0]!.id, `Penalty or dive ${RUN}`],
    );
    await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
      storyId,
      article.rows[0]!.id,
    ]);
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      // The audit log is immutable by design; a test's own rows go with the triggers off.
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM audit_log WHERE target_type = 'story' AND target_id = $1`, [
        storyId,
      ]);
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
    await pool.query(`DELETE FROM story WHERE id = $1`, [storyId]);
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`db_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('lets only an editor or administrator select, and insists on the note', async () => {
    const guest = await app.inject({
      method: 'POST',
      url: `/admin/stories/${storyId}/debate`,
      payload: { note: 'Was it a penalty?' },
    });
    expect(guest.statusCode).toBe(401);
    const member = await app.inject({
      method: 'POST',
      url: `/admin/stories/${storyId}/debate`,
      headers: as(`db_${RUN}m`),
      payload: { note: 'Was it a penalty?' },
    });
    expect(member.statusCode).toBe(403);
    const blank = await app.inject({
      method: 'POST',
      url: `/admin/stories/${storyId}/debate`,
      headers: as(`db_${RUN}e`),
      payload: { note: '   ' },
    });
    expect(blank.statusCode).toBe(400);
    const missing = await app.inject({
      method: 'POST',
      url: `/admin/stories/00000000-0000-4000-8000-00000000dead/debate`,
      headers: as(`db_${RUN}e`),
      payload: { note: 'Was it a penalty?' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('puts a selected story on the debate section with the note, refuses a second selection, and audits the decision', async () => {
    const selected = await app.inject({
      method: 'POST',
      url: `/admin/stories/${storyId}/debate`,
      headers: as(`db_${RUN}e`),
      payload: { note: 'Was it a penalty?' },
    });
    expect(selected.statusCode).toBe(204);

    const section = await app.inject({ method: 'GET', url: '/news?section=debate' });
    const card = section
      .json<NewsSectionResponse>()
      .stories.data!.find((c) => c.story_id === storyId);
    expect(card).toMatchObject({
      headline: `Penalty or dive ${RUN}`,
      debate: { note: 'Was it a penalty?' },
    });

    const again = await app.inject({
      method: 'POST',
      url: `/admin/stories/${storyId}/debate`,
      headers: as(`db_${RUN}e`),
      payload: { note: 'A different note' },
    });
    expect(again.statusCode).toBe(400);

    const list = await app.inject({
      method: 'GET',
      url: '/admin/debates?state=open',
      headers: as(`db_${RUN}e`),
    });
    const mine = list.json<DebateListResponse>().selections.find((s) => s.story_id === storyId);
    expect(mine).toMatchObject({
      headline: `Penalty or dive ${RUN}`,
      selected_by: `db_${RUN}e`,
      note: 'Was it a penalty?',
      cleared_at: null,
    });

    const audit = await pool.query<{
      action: string;
      actor_id: string;
      reason: string;
      previous: unknown;
    }>(
      `SELECT action, actor_id, reason, previous FROM audit_log
        WHERE target_type = 'story' AND target_id = $1 ORDER BY created_at`,
      [storyId],
    );
    expect(audit.rows).toEqual([
      {
        action: 'debate.select',
        actor_id: ids.get(`db_${RUN}e`),
        reason: 'Was it a penalty?',
        previous: null,
      },
    ]);
  });

  it('clears with a reason, keeps the record, and takes the story off the section', async () => {
    const noReason = await app.inject({
      method: 'POST',
      url: `/admin/stories/${storyId}/debate/clear`,
      headers: as(`db_${RUN}e`),
      payload: {},
    });
    expect(noReason.statusCode).toBe(400);
    const cleared = await app.inject({
      method: 'POST',
      url: `/admin/stories/${storyId}/debate/clear`,
      headers: as(`db_${RUN}e`),
      payload: { reason: 'The referee explained the call.' },
    });
    expect(cleared.statusCode).toBe(204);
    const twice = await app.inject({
      method: 'POST',
      url: `/admin/stories/${storyId}/debate/clear`,
      headers: as(`db_${RUN}e`),
      payload: { reason: 'Again' },
    });
    expect(twice.statusCode).toBe(404);

    const section = await app.inject({ method: 'GET', url: '/news?section=debate' });
    expect(section.json<NewsSectionResponse>().stories.data!.map((c) => c.story_id)).not.toContain(
      storyId,
    );

    const list = await app.inject({
      method: 'GET',
      url: '/admin/debates?state=cleared',
      headers: as(`db_${RUN}e`),
    });
    const record = list.json<DebateListResponse>().selections.find((s) => s.story_id === storyId);
    expect(record).toMatchObject({
      cleared_by: `db_${RUN}e`,
      cleared_reason: 'The referee explained the call.',
    });
    expect(record?.cleared_at).not.toBeNull();

    const audit = await pool.query<{ action: string; previous: { note: string } | null }>(
      `SELECT action, previous FROM audit_log
        WHERE target_type = 'story' AND target_id = $1 ORDER BY created_at`,
      [storyId],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['debate.select', 'debate.clear']);
    expect(audit.rows[1]!.previous?.note).toBe('Was it a penalty?');

    // Selecting again after a clear is a new selection whose audit row remembers the old one.
    const reselected = await app.inject({
      method: 'POST',
      url: `/admin/stories/${storyId}/debate`,
      headers: as(`db_${RUN}e`),
      payload: { note: 'The argument is back.' },
    });
    expect(reselected.statusCode).toBe(204);
    const last = await pool.query<{ previous: { note: string } | null }>(
      `SELECT previous FROM audit_log
        WHERE target_type = 'story' AND target_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [storyId],
    );
    expect(last.rows[0]!.previous?.note).toBe('Was it a penalty?');
  });
});
