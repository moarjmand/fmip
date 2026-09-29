import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { StoryPage, TranslationDesk, TranslationQueue } from '@fmip/contracts';
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
  const checked: string[] = [];
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
  const translate = (who: string, article: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/admin/articles/${article}/translations`,
      headers: as(who),
      payload,
    });
  const review = (who: string, article: string, language: string, payload?: object) =>
    app.inject({
      method: 'POST',
      url: `/admin/articles/${article}/translations/${language}/review`,
      headers: as(who),
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
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
        `DELETE FROM audit_log WHERE target_type = 'article' AND target_id = ANY($1::text[])`,
        [[articleId, headlineOnlyArticle, ...checked]],
      );
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM news_source WHERE id = ANY($1::uuid[])`, [sources]);
    await pool.query(`DELETE FROM entity_alias WHERE source = $1`, [`t1012-${RUN}`]);
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

  describe('the automatic checks (T-1012)', () => {
    /** An article whose newest headline carries a score, a date and a linked team. */
    async function scored(): Promise<{ article: string; team: string; teamName: string }> {
      const made = await article('summary');
      checked.push(made.article);
      const team = await pool.query<{ id: string; name: string }>(
        `SELECT id, name FROM team WHERE length(name) >= 5 ORDER BY name LIMIT 1`,
      );
      const { id, name } = team.rows[0]!;
      await pool.query(
        `INSERT INTO article_version (article_id, language, version_number, headline, summary, published_at)
         VALUES ($1, 'en', 2, $2, 'A late header settled it.', '2026-09-18T11:00:00Z')`,
        [made.article, `${name} win 2-1 on 12 May`],
      );
      await pool.query(
        `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
        [made.article, id],
      );
      return { article: made.article, team: id, teamName: name };
    }

    it('refuses a review while a check fails, naming every failure beside its field', async () => {
      const { article: id, teamName } = await scored();
      // The score reversed: every number is there, the scoreline is not.
      const written = await translate(`tl_${RUN}a`, id, {
        language: 'de',
        headline: `${teamName} 1-2 am 12. Mai`,
        summary: 'Ein spaeter Kopfball.',
      });
      expect(written.statusCode).toBe(201);
      const refused = await review(`tl_${RUN}b`, id, 'de');
      expect(refused.statusCode).toBe(400);
      const body = refused.json<{
        error: string;
        fields: Record<string, string>;
        checks: { check: string }[];
      }>();
      expect(body.error).toBe('validation');
      expect(Object.keys(body.fields)).toEqual(['headline.scorelines']);
      expect(body.checks.map((c) => c.check)).toEqual(['scorelines']);
      // Nothing was written: no reviewed version, no override, no audit row.
      const reviewed = await pool.query(
        `SELECT 1 FROM article_version WHERE article_id = $1 AND language = 'de' AND review_state = 'reviewed'`,
        [id],
      );
      expect(reviewed.rowCount).toBe(0);
      const audit = await pool.query<{ action: string }>(
        `SELECT action FROM audit_log WHERE target_type = 'article' AND target_id = $1`,
        [id],
      );
      expect(audit.rows.map((row) => row.action)).toEqual(['translation.write']);

      // A reason must say something, and must be for a check that fails.
      const blank = await review(`tl_${RUN}b`, id, 'de', {
        overrides: [{ check: 'scorelines', field: 'headline', reason: '  ' }],
      });
      expect(blank.statusCode).toBe(400);
      const notFailing = await review(`tl_${RUN}b`, id, 'de', {
        overrides: [
          { check: 'scorelines', field: 'headline', reason: 'The source has it wrong.' },
          { check: 'numbers', field: 'headline', reason: 'Nothing to pass.' },
        ],
      });
      expect(notFailing.statusCode).toBe(400);
      expect(notFailing.json<{ message: string }>().message).toMatch(/does not fail/);
      const overrides = await pool.query(
        `SELECT 1 FROM translation_check_override WHERE article_id = $1`,
        [id],
      );
      expect(overrides.rowCount).toBe(0);
    });

    it("passes a failing check with the reviewer's reason, recorded and audited", async () => {
      const { article: id, teamName } = await scored();
      await translate(`tl_${RUN}a`, id, {
        language: 'de',
        headline: `${teamName} 1-2 am 12. Mai`,
        summary: 'Ein spaeter Kopfball.',
      });
      const reason =
        'The publisher printed the away score first; the translation follows the match.';
      const passed = await review(`tl_${RUN}b`, id, 'de', {
        overrides: [{ check: 'scorelines', field: 'headline', reason }],
      });
      expect(passed.statusCode).toBe(204);
      const overrides = await pool.query(
        `SELECT version_number, check_name, field, reason, reviewer_id FROM translation_check_override
          WHERE article_id = $1`,
        [id],
      );
      expect(overrides.rows).toEqual([
        {
          version_number: 1,
          check_name: 'scorelines',
          field: 'headline',
          reason,
          reviewer_id: ids.get(`tl_${RUN}b`),
        },
      ]);
      const audit = await pool.query<{
        action: string;
        actor_id: string;
        reason: string;
        previous: Record<string, unknown>;
      }>(
        `SELECT action, actor_id, reason, previous FROM audit_log
          WHERE target_type = 'article' AND target_id = $1
          ORDER BY created_at, CASE action WHEN 'translation.write' THEN 0
                                           WHEN 'translation.check_override' THEN 1 ELSE 2 END`,
        [id],
      );
      expect(audit.rows.map((row) => row.action)).toEqual([
        'translation.write',
        'translation.check_override',
        'translation.review',
      ]);
      expect(audit.rows[1]).toMatchObject({
        actor_id: ids.get(`tl_${RUN}b`),
        reason,
        previous: { check: 'scorelines', field: 'headline', outcome: 'fail', version_number: 1 },
      });
      // The override is immutable, like the version it belongs to.
      await expect(
        pool.query(`UPDATE translation_check_override SET reason = 'x' WHERE article_id = $1`, [
          id,
        ]),
      ).rejects.toThrow(/immutable/);
    });

    it('fails a linked team not written as its localised name, and passes it once it is', async () => {
      const { article: id, team, teamName } = await scored();
      // A stand-in for a localised name a person recorded (T-303): the test
      // writes a marker, never a word in another language.
      // No digits in it: the numbers check would rightly count them.
      const localised = `Localised${RUN.replace(/[0-9]/g, 'x')}`;
      await pool.query(
        `INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
         VALUES ('team', $1, $2, 'it', 'name', $3)`,
        [team, localised, `t1012-${RUN}`],
      );
      await translate(`tl_${RUN}a`, id, {
        language: 'it',
        headline: `${teamName} 2-1 il 12 maggio`,
        summary: 'Un colpo di testa.',
      });
      const refused = await review(`tl_${RUN}b`, id, 'it');
      expect(refused.statusCode).toBe(400);
      expect(Object.keys(refused.json<{ fields: Record<string, string> }>().fields)).toEqual([
        'headline.names',
      ]);
      await translate(`tl_${RUN}a`, id, {
        language: 'it',
        headline: `${localised} 2-1 il 12 maggio`,
        summary: 'Un colpo di testa.',
      });
      const passed = await review(`tl_${RUN}b`, id, 'it');
      expect(passed.statusCode).toBe(204);
    });

    it("refuses a reason on the publisher's own words at the schema", async () => {
      const { article: id } = await scored();
      await expect(
        pool.query(
          `INSERT INTO translation_check_override
             (article_id, language, version_number, check_name, field, reason, reviewer_id)
           VALUES ($1, 'en', 1, 'numbers', 'headline', 'why', $2)`,
          [id, ids.get(`tl_${RUN}b`)],
        ),
      ).rejects.toThrow(/only on a translation/);
    });
  });

  describe('the desk (T-1013)', () => {
    const desk = (who: string, article: string, language: string) =>
      app.inject({
        method: 'GET',
        url: `/admin/articles/${article}/translations/${language}`,
        headers: as(who),
      });
    const queue = (who: string, language: string) =>
      app.inject({
        method: 'GET',
        url: `/admin/translations?language=${language}`,
        headers: as(who),
      });

    it('is for editors only, and asks for a language', async () => {
      expect((await queue(`tl_${RUN}m`, 'tr')).statusCode).toBe(403);
      expect((await desk(`tl_${RUN}m`, articleId, 'tr')).statusCode).toBe(403);
      expect((await queue(`tl_${RUN}a`, 'not a tag')).statusCode).toBe(400);
      expect(
        (await desk(`tl_${RUN}a`, '00000000-0000-4000-8000-00000000dead', 'tr')).statusCode,
      ).toBe(404);
    });

    it('queues an article from to-translate, to awaiting review, to reviewed', async () => {
      const made = await article('summary');
      checked.push(made.article);
      await pool.query(
        `INSERT INTO article_version (article_id, language, version_number, headline, summary, published_at)
         VALUES ($1, 'en', 2, $2, 'Scored a goal.', '2026-09-18T11:00:00Z')`,
        [made.article, `A goal settled it ${RUN}`],
      );
      const articleIds = (list: { article_id: string }[]) => list.map((item) => item.article_id);
      const before = (await queue(`tl_${RUN}a`, 'tr')).json<TranslationQueue>();
      expect(articleIds(before.to_translate)).toContain(made.article);
      expect(before.to_translate.find((i) => i.article_id === made.article)).toMatchObject({
        headline: `A goal settled it ${RUN}`,
        source_language: 'en',
        rights: 'summary',
        translation: null,
      });

      // The desk, before anything is written: the source, the fields it
      // offers, the glossary terms it uses, and no checks.
      const empty = (await desk(`tl_${RUN}a`, made.article, 'tr')).json<TranslationDesk>();
      expect(empty.translation).toBeNull();
      expect(empty.checks).toEqual([]);
      expect(empty.fields).toEqual(['headline', 'summary']);
      expect(empty.glossary.map((hit) => hit.key)).toContain('term.goal');
      // Nobody has written the term: it is shown empty, never filled.
      expect(empty.glossary.find((hit) => hit.key === 'term.goal')).toMatchObject({
        text: '',
        status: 'untranslated',
      });

      await translate(`tl_${RUN}a`, made.article, {
        language: 'tr',
        headline: `Bir gol ${RUN}`,
        summary: 'Bir gol.',
      });
      const waiting = (await queue(`tl_${RUN}a`, 'tr')).json<TranslationQueue>();
      expect(articleIds(waiting.to_translate)).not.toContain(made.article);
      expect(waiting.awaiting_review.find((i) => i.article_id === made.article)).toMatchObject({
        translation: {
          version_number: 1,
          review_state: 'translated',
          written_by: { username: `tl_${RUN}a` },
          reviewed_by: null,
        },
      });

      const mine = (await desk(`tl_${RUN}a`, made.article, 'tr')).json<TranslationDesk>();
      expect(mine.viewer_is_author).toBe(true);
      expect(mine.checks.map((c) => `${c.field}.${c.check}.${c.outcome}`)).toContain(
        'headline.numbers.pass',
      );
      const theirs = (await desk(`tl_${RUN}b`, made.article, 'tr')).json<TranslationDesk>();
      expect(theirs.viewer_is_author).toBe(false);

      expect((await review(`tl_${RUN}b`, made.article, 'tr')).statusCode).toBe(204);
      const done = (await queue(`tl_${RUN}a`, 'tr')).json<TranslationQueue>();
      expect(articleIds(done.awaiting_review)).not.toContain(made.article);
      expect(done.reviewed.find((i) => i.article_id === made.article)).toMatchObject({
        translation: { review_state: 'reviewed', reviewed_by: { username: `tl_${RUN}b` } },
      });
    });

    it('offers only the headline for a source that grants only the headline', async () => {
      const view = (await desk(`tl_${RUN}a`, headlineOnlyArticle, 'tr')).json<TranslationDesk>();
      expect(view.source.rights).toBe('headline');
      expect(view.fields).toEqual(['headline']);
    });
  });
});
