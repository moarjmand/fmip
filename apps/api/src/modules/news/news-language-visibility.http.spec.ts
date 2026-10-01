import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type {
  ApiError,
  EntityNewsResponse,
  NewsSectionResponse,
  NewsSourceWriteResponse,
  SavedArticlesResponse,
  StoryPage,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { NewsModule } from './news.module';

/**
 * A source's stories only for readers of its language (T-1330, D-178): a
 * Persian source with `same_language_only` is left out of every read in
 * another language and shown in Persian (any `fa-*` tag); a story that also
 * has a report from a source every reader sees is shown to the others with
 * that report's headline; a story with no report the reader is shown is a
 * 404 on its page; a saved one stays on the list and says why it is not
 * shown; a read with no locale filters nothing. The setting is the
 * administrators', with a reason, audited with the previous value (rule 10).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const TEAM = randomUUID();

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'news shown by the reader’s language (T-1330, D-178)',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    let persian: string;
    let english: string;
    let persianOnly: string;
    let mixed: string;
    const stories: string[] = [];
    const cookies = new Map<string, string>();
    const admin = `lv_${RUN}a`;
    const editor = `lv_${RUN}e`;
    const reader = `lv_${RUN}r`;

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
      cookies.set(username, cookieValue(response.headers['set-cookie']));
      const { rows } = await pool.query<{ id: string }>(
        `SELECT id FROM user_account WHERE username = $1`,
        [username],
      );
      return rows[0]!.id;
    }

    const call = (
      method: 'GET' | 'POST' | 'PUT',
      url: string,
      username: string | null = null,
      payload?: Record<string, unknown>,
    ) =>
      app.inject({
        method,
        url,
        headers: username === null ? {} : { cookie: `fmip_session=${cookies.get(username) ?? ''}` },
        ...(payload === undefined ? {} : { payload }),
      });

    async function source(name: string, language: string, sameLanguageOnly: boolean) {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language, same_language_only)
         VALUES ($1, 'https://scripted.test', $2, 'rss', 'headline', $3, $4) RETURNING id`,
        [`${name} ${RUN}`, `https://scripted.test/${name}-${RUN}.xml`, language, sameLanguageOnly],
      );
      const id = rows[0]!.id;
      await pool.query(
        `INSERT INTO news_fetch (source_id, status, started_at, finished_at)
         VALUES ($1, 'succeeded', now() - interval '2 minutes', now() - interval '1 minute')`,
        [id],
      );
      return id;
    }

    async function article(
      storyId: string,
      sourceId: string,
      language: string,
      headline: string,
      fetchedAt: string,
    ): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO article (source_id, story_id, external_id, url, fetched_at)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [
          sourceId,
          storyId,
          `${headline}-${RUN}`,
          `https://scripted.test/${randomUUID()}`,
          fetchedAt,
        ],
      );
      const id = rows[0]!.id;
      await pool.query(
        `INSERT INTO article_version (article_id, language, version_number, headline, published_at)
         VALUES ($1, $2, 1, $3, $4)`,
        [id, language, headline, fetchedAt],
      );
      await pool.query(
        `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
        [id, TEAM],
      );
      return id;
    }

    async function story(promoted: (storyId: string) => Promise<string>): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO story DEFAULT VALUES RETURNING id`,
      );
      const id = rows[0]!.id;
      stories.push(id);
      const articleId = await promoted(id);
      await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [id, articleId]);
      return id;
    }

    async function latest(locale: string | null) {
      const query = new URLSearchParams({ section: 'latest', team: TEAM });
      if (locale !== null) query.set('locale', locale);
      const response = await call('GET', `/news?${query.toString()}`);
      expect(response.statusCode).toBe(200);
      return response.json<NewsSectionResponse>().stories.data!;
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
        `INSERT INTO team (id, country_id, name, kind, gender) VALUES ($1, $2, $3, 'club', 'men')`,
        [TEAM, ENGLAND, `Langford ${RUN}`],
      );
      persian = await source('persian', 'fa', true);
      english = await source('english', 'en', false);
      persianOnly = await story((id) =>
        article(id, persian, 'fa', `خبر فارسی ${RUN}`, '2026-09-20T09:00:00Z'),
      );
      mixed = await story(async (id) => {
        await article(id, english, 'en', `English report ${RUN}`, '2026-09-21T08:00:00Z');
        return article(id, persian, 'fa', `گزارش فارسی ${RUN}`, '2026-09-21T09:00:00Z');
      });

      const adminId = await register(admin);
      const editorId = await register(editor);
      await register(reader);
      await pool.query(
        `INSERT INTO user_role (user_id, role, granted_by, reason)
         VALUES ($1, 'admin', $1, 'the language visibility test'),
                ($2, 'editor', $1, 'the language visibility test')`,
        [adminId, editorId],
      );
    });

    afterAll(async () => {
      await withTriggersOff(pool, async (client) => {
        await client.query(
          `DELETE FROM audit_log WHERE target_type = 'news_source' AND target_id = ANY($1::text[])`,
          [[persian, english]],
        );
      });
      await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`lv_${RUN}%`]);
      await pool.query(`DELETE FROM news_source WHERE id = ANY($1::uuid[])`, [[persian, english]]);
      await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
      await pool.query(`DELETE FROM team WHERE id = $1`, [TEAM]);
      await pool.end();
      await app.close();
    });

    it('leaves the Persian-only story out in English and shows the mixed one by its English report', async () => {
      const cards = await latest('en');
      expect(cards.map((c) => c.story_id)).toEqual([mixed]);
      expect(cards[0]).toMatchObject({
        headline: `English report ${RUN}`,
        language: 'en',
        other_reports: 0,
        source: { id: english },
      });
      const team = (await call('GET', `/teams/${TEAM}/news?locale=en`)).json<EntityNewsResponse>();
      expect(team.stories.data!.map((c) => c.story_id)).toEqual([mixed]);
    });

    it('shows both to a Persian reader, any fa tag, with the promoted original', async () => {
      for (const locale of ['fa', 'fa-IR']) {
        const cards = await latest(locale);
        expect(cards.map((c) => c.story_id)).toEqual([mixed, persianOnly]);
        expect(cards[0]).toMatchObject({ headline: `گزارش فارسی ${RUN}`, other_reports: 1 });
      }
    });

    it('filters nothing for a read with no locale (an internal caller)', async () => {
      expect((await latest(null)).map((c) => c.story_id)).toEqual([mixed, persianOnly]);
    });

    it('answers the story page as missing to a reader shown none of its reports', async () => {
      const hidden = await call('GET', `/news/stories/${persianOnly}?locale=en`);
      expect(hidden.statusCode).toBe(404);
      expect((await call('GET', `/news/stories/${persianOnly}?locale=fa`)).statusCode).toBe(200);
      const page = (await call('GET', `/news/stories/${mixed}?locale=en`)).json<StoryPage>();
      expect(page.story.headline).toBe(`English report ${RUN}`);
      expect(page.reports).toEqual([]);
      const persianPage = (await call('GET', `/news/stories/${mixed}?locale=fa`)).json<StoryPage>();
      expect(persianPage.story.headline).toBe(`گزارش فارسی ${RUN}`);
      expect(persianPage.reports.map((r) => r.source.id)).toEqual([english]);
    });

    it('keeps a saved story on the list and says it is not shown in this language', async () => {
      expect(
        (await call('PUT', `/me/saved-articles/${persianOnly}?locale=fa`, reader)).statusCode,
      ).toBe(200);
      // An English reader cannot save what they are not shown.
      expect(
        (await call('PUT', `/me/saved-articles/${persianOnly}?locale=en`, editor)).statusCode,
      ).toBe(404);
      const inEnglish = (
        await call('GET', '/me/saved-articles?locale=en', reader)
      ).json<SavedArticlesResponse>();
      expect(inEnglish.saved.find((s) => s.story_id === persianOnly)).toMatchObject({
        state: 'other_language',
        headline: null,
        url: null,
      });
      const inPersian = (
        await call('GET', '/me/saved-articles?locale=fa', reader)
      ).json<SavedArticlesResponse>();
      expect(inPersian.saved.find((s) => s.story_id === persianOnly)).toMatchObject({
        state: 'available',
        headline: `خبر فارسی ${RUN}`,
      });
    });

    it('is set by administrators only, with a reason, audited with the previous value', async () => {
      const url = `/admin/news-sources/${persian}/visibility`;
      const body = { same_language_only: false, reason: 'Shown to every reader (a test).' };
      expect((await call('POST', url, null, body)).statusCode).toBe(401);
      expect((await call('POST', url, editor, body)).statusCode).toBe(403);
      const noReason = await call('POST', url, admin, { same_language_only: false });
      expect(noReason.statusCode).toBe(400);
      expect(noReason.json<ApiError>().fields).toHaveProperty('reason');
      const notBoolean = await call('POST', url, admin, { same_language_only: 'no', reason: 'x' });
      expect(notBoolean.json<ApiError>().fields).toHaveProperty('same_language_only');

      const set = await call('POST', url, admin, body);
      expect(set.statusCode).toBe(200);
      const written = set.json<NewsSourceWriteResponse>();
      expect(written.source.same_language_only).toBe(false);
      const again = await call('POST', url, admin, body);
      expect(again.statusCode).toBe(400);

      const { rows } = await pool.query<{
        action: string;
        actor_id: string;
        reason: string;
        previous: Record<string, unknown>;
        next: Record<string, unknown>;
      }>(
        `SELECT a.action, a.actor_id, a.reason, a.previous, a.next
           FROM audit_log a WHERE a.id = $1`,
        [written.audit_id],
      );
      expect(rows[0]).toMatchObject({
        action: 'news_source.visibility',
        reason: 'Shown to every reader (a test).',
        previous: { same_language_only: true },
        next: { same_language_only: false },
      });

      // Off: every reader is shown it.
      expect((await latest('en')).map((c) => c.story_id)).toEqual([mixed, persianOnly]);
      expect((await call('GET', `/news/stories/${persianOnly}?locale=en`)).statusCode).toBe(200);
      const saved = (
        await call('GET', '/me/saved-articles?locale=en', reader)
      ).json<SavedArticlesResponse>();
      expect(saved.saved.find((s) => s.story_id === persianOnly)?.state).toBe('available');

      // And back on.
      const on = await call('POST', url, admin, {
        same_language_only: true,
        reason: 'Persian readers only again (a test).',
      });
      expect(on.statusCode).toBe(200);
      expect((await latest('en')).map((c) => c.story_id)).toEqual([mixed]);
    });
  },
);
