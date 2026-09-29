import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import {
  NEWS_COVERAGE_FLOOR,
  NEWS_COVERAGE_WINDOW_DAYS,
  type EntityNewsResponse,
  type NewsCoverageReport,
  newsCoverageState,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { NewsModule } from './news.module';

/**
 * News coverage per competition, stated (T-1010, D-129): the carried
 * sources that linked a story to a competition inside the window and the
 * distinct stories; a dropped source and a report older than the window do
 * not count; the competition page's news is `limited` with the reason below
 * the floor, and never looks populated when no carried source covers it
 * (rule 3); the console's report puts the gaps first and is editors' only.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const COVERED = randomUUID();
const THIN = randomUUID();
const BARE = randomUUID();
const RETIRED = randomUUID();

describe('newsCoverageState (D-129)', () => {
  it('names no carried source, below the floor, and covered', () => {
    expect(newsCoverageState(0, 5)).toBe('no_carried_source');
    expect(newsCoverageState(4, 5)).toBe('below_floor');
    expect(newsCoverageState(5, 5)).toBe('covered');
  });
});

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('news coverage (T-1010)', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const sources = new Map<'a' | 'b' | 'dropped', string>();
  const stories: string[] = [];
  const cookies = new Map<string, string>();
  const editor = `nc_${RUN}e`;
  const member = `nc_${RUN}m`;

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

  /** One story; each report is (source, competition, days before now). */
  async function story(reports: { source: string; competition: string; ago: number }[]) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO story DEFAULT VALUES RETURNING id`,
    );
    const storyId = rows[0]!.id;
    stories.push(storyId);
    let first: string | null = null;
    for (const [index, report] of reports.entries()) {
      const article = await pool.query<{ id: string }>(
        `INSERT INTO article (source_id, story_id, external_id, url)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [
          report.source,
          storyId,
          `${storyId}-${String(index)}`,
          `https://scripted.test/${storyId}/${String(index)}`,
        ],
      );
      const articleId = article.rows[0]!.id;
      first ??= articleId;
      await pool.query(
        `INSERT INTO article_version (article_id, language, version_number, headline, published_at)
         VALUES ($1, 'en', 1, $2, now() - make_interval(days => $3::int))`,
        [articleId, `Coverage ${RUN} ${storyId}`, report.ago],
      );
      await pool.query(
        `INSERT INTO article_entity (article_id, entity_type, entity_id)
         VALUES ($1, 'competition', $2)`,
        [articleId, report.competition],
      );
    }
    await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [storyId, first]);
  }

  const competitionNews = async (id: string) =>
    (
      await app.inject({ method: 'GET', url: `/competitions/${id}/news` })
    ).json<EntityNewsResponse>();

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

    const editorId = await register(editor);
    await register(member);
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'editor', $1, 'the news coverage test')`,
      [editorId],
    );
    await pool.query(
      `INSERT INTO competition (id, country_id, name, kind, scope, gender, is_active)
       VALUES ($1, $5, $6, 'league', 'domestic', 'men', true),
              ($2, $5, $7, 'league', 'domestic', 'men', true),
              ($3, $5, $8, 'league', 'domestic', 'men', true),
              ($4, $5, $9, 'league', 'domestic', 'men', false)`,
      [
        COVERED,
        THIN,
        BARE,
        RETIRED,
        ENGLAND,
        `Covered League ${RUN}`,
        `Thin League ${RUN}`,
        `Bare League ${RUN}`,
        `Retired League ${RUN}`,
      ],
    );
    for (const key of ['a', 'b', 'dropped'] as const) {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
         VALUES ($1, 'https://scripted.test', $2, 'rss', 'headline', 'en') RETURNING id`,
        [`Coverage ${key} ${RUN}`, `https://scripted.test/coverage-${key}-${RUN}.xml`],
      );
      sources.set(key, rows[0]!.id);
    }
    await pool.query(
      `INSERT INTO news_fetch (source_id, status, started_at, finished_at)
       VALUES ($1, 'succeeded', now() - interval '2 minutes', now() - interval '1 minute')`,
      [sources.get('a')],
    );
    const a = sources.get('a')!;
    const b = sources.get('b')!;
    const dropped = sources.get('dropped')!;
    // Covered: four stories from A, one of them also from B, and one from B alone -- five stories.
    for (let i = 0; i < 3; i += 1) await story([{ source: a, competition: COVERED, ago: 2 }]);
    await story([
      { source: a, competition: COVERED, ago: 3 },
      { source: b, competition: COVERED, ago: 3 },
    ]);
    await story([{ source: b, competition: COVERED, ago: 1 }]);
    // Thin: one story inside the window; one outside it; one from a source dropped later.
    await story([{ source: a, competition: THIN, ago: 5 }]);
    await story([{ source: a, competition: THIN, ago: NEWS_COVERAGE_WINDOW_DAYS + 10 }]);
    await story([{ source: dropped, competition: THIN, ago: 1 }]);
    // Bare: an old story from a carried source, and a recent one from the dropped source only.
    await story([{ source: a, competition: BARE, ago: NEWS_COVERAGE_WINDOW_DAYS + 5 }]);
    await story([{ source: dropped, competition: BARE, ago: 1 }]);
    await pool.query(
      `UPDATE news_source SET dropped_at = now(), dropped_reason = 'The publisher asked to be dropped.'
        WHERE id = $1`,
      [dropped],
    );
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM news_source WHERE id = ANY($1::uuid[])`, [[...sources.values()]]);
    if (stories.length > 0) {
      await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
    }
    await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [
      [COVERED, THIN, BARE, RETIRED],
    ]);
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`nc_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('a covered competition is available, with its sources and distinct stories', async () => {
    const body = await competitionNews(COVERED);
    expect(body.stories.coverage).toBe('available');
    expect(body.reason).toBeNull();
    expect(body.coverage).toEqual({
      window_days: NEWS_COVERAGE_WINDOW_DAYS,
      floor: NEWS_COVERAGE_FLOOR,
      stories: 5,
      sources: [
        { id: sources.get('a'), name: `Coverage a ${RUN}`, stories: 4 },
        { id: sources.get('b'), name: `Coverage b ${RUN}`, stories: 2 },
      ],
    });
  });

  it('below the floor the news is limited, counting neither old reports nor dropped sources', async () => {
    const body = await competitionNews(THIN);
    expect(body.stories.coverage).toBe('limited');
    expect(body.reason).toBe('below_floor');
    expect(body.coverage?.stories).toBe(1);
    expect(body.coverage?.sources).toEqual([
      { id: sources.get('a'), name: `Coverage a ${RUN}`, stories: 1 },
    ]);
  });

  it('with no carried source it says so, even over an old story (rule 3)', async () => {
    const body = await competitionNews(BARE);
    expect(body.stories.coverage).toBe('limited');
    expect(body.reason).toBe('no_carried_source');
    expect(body.coverage).toMatchObject({ stories: 0, sources: [] });
  });

  it('a team keeps its news as it was, with no coverage block', async () => {
    const team = randomUUID();
    await pool.query(
      `INSERT INTO team (id, country_id, name, kind, gender) VALUES ($1, $2, $3, 'club', 'men')`,
      [team, ENGLAND, `Coverage Town ${RUN}`],
    );
    try {
      const body = (
        await app.inject({ method: 'GET', url: `/teams/${team}/news` })
      ).json<EntityNewsResponse>();
      expect(body.reason).toBe('nothing_linked');
      expect(body.coverage).toBeUndefined();
    } finally {
      await pool.query(`DELETE FROM team WHERE id = $1`, [team]);
    }
  });

  it("the console's report lists active competitions, the gaps first, for editors only", async () => {
    const get = (username: string | null) =>
      app.inject({
        method: 'GET',
        url: '/admin/news/coverage',
        headers: username === null ? {} : { cookie: `fmip_session=${cookies.get(username) ?? ''}` },
      });
    expect((await get(null)).statusCode).toBe(401);
    expect((await get(member)).statusCode).toBe(403);
    const response = await get(editor);
    expect(response.statusCode).toBe(200);
    const report = response.json<NewsCoverageReport>();
    expect(report.window_days).toBe(NEWS_COVERAGE_WINDOW_DAYS);
    expect(report.floor).toBe(NEWS_COVERAGE_FLOOR);
    expect(report.carried_sources).toBeGreaterThanOrEqual(2);
    expect(report.feeds_read_at).not.toBeNull();
    const ours = report.competitions.filter((row) =>
      ([COVERED, THIN, BARE, RETIRED] as string[]).includes(row.competition.id),
    );
    expect(ours.map((row) => [row.competition.id, row.state])).toEqual([
      [BARE, 'no_carried_source'],
      [THIN, 'below_floor'],
      [COVERED, 'covered'],
    ]);
    // Gaps before covered, across the whole report.
    const states = report.competitions.map((row) => row.state);
    const firstCovered = states.indexOf('covered');
    if (firstCovered !== -1)
      expect(states.slice(firstCovered).every((s) => s === 'covered')).toBe(true);
  });
});
