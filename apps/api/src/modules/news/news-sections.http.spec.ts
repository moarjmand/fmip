import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { NewsSectionResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { NewsModule } from './news.module';

/**
 * The four sections over the real schema (T-143, blueprint 3.1 and 3.2).
 *
 * Two stories are written straight into the tables -- one about a match
 * between two clubs of this run, with an English version; one about nothing
 * in particular, in French -- and every section is asked what it holds:
 * latest in order with the cursor; the filters by team, country and language;
 * trending from public discussion and only that, said out loud; debate as
 * what an editor selected and nothing when nobody has; following as what the
 * member follows, and for a guest a section that says it needs one.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const HOME = randomUUID();
const AWAY = randomUUID();
const MATCH = randomUUID();

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('news sections', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let source: string;
  let matchStory: string;
  let otherStory: string;
  const members = new Map<string, { id: string; cookie: string }>();

  async function register(username: string): Promise<{ id: string; cookie: string }> {
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
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
      [username],
    );
    const member = { id: rows[0]!.id, cookie: cookieValue(response.headers['set-cookie']) };
    members.set(username, member);
    return member;
  }

  /** A story of one report, with its version and links, promoted as its own original. */
  async function story(
    headline: string,
    language: string,
    publishedAt: string,
    links: { type: string; id: string }[],
  ): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO story DEFAULT VALUES RETURNING id`,
    );
    const storyId = rows[0]!.id;
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
      `INSERT INTO article_version (article_id, language, version_number, headline, summary, published_at)
       VALUES ($1, $2, 1, $3, 'What the publisher wrote.', $4)`,
      [articleId, language, headline, publishedAt],
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

  async function section(
    query: string,
    cookie?: string,
  ): Promise<{ status: number; body: NewsSectionResponse }> {
    const response = await app.inject({
      method: 'GET',
      url: `/news?${query}`,
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });
    return { status: response.statusCode, body: response.json<NewsSectionResponse>() };
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
       VALUES ($1, $3, $4, 'TVR', 'club', 'men'), ($2, $3, $5, 'OTA', 'club', 'men')`,
      [HOME, AWAY, ENGLAND, `Testville Rovers ${RUN}`, `Otherton Athletic ${RUN}`],
    );
    await pool.query(
      `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
       VALUES ($1, $2, $3, 'Matchday 20', now() - interval '1 day', 'finished')`,
      [MATCH, PL_2025, REGULAR_SEASON],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [MATCH, HOME, AWAY],
    );
    const src = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
       VALUES ($1, 'https://scripted.test', $2, 'rss', 'summary', 'en') RETURNING id`,
      [`Sections ${RUN}`, `https://scripted.test/sections-${RUN}.xml`],
    );
    source = src.rows[0]!.id;
    matchStory = await story(`Rovers edge Athletic ${RUN}`, 'en', '2026-09-17T16:00:00Z', [
      { type: 'team', id: HOME },
      { type: 'team', id: AWAY },
      { type: 'fixture', id: MATCH },
    ]);
    otherStory = await story(`Le mercato ${RUN}`, 'fr', '2026-09-18T08:00:00Z', []);
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      // Panel posts refuse DELETE by design (PL007); a test's own rows go with the triggers off.
      await client.query(`SET session_replication_role = replica`);
      await client.query(`DELETE FROM panel_post WHERE fixture_id = $1`, [MATCH]);
      await client.query(`RESET session_replication_role`);
    } finally {
      client.release();
    }
    await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
    await pool.query(`DELETE FROM story WHERE id IN ($1, $2)`, [matchStory, otherStory]);
    await pool.query(`DELETE FROM fixture WHERE id = $1`, [MATCH]);
    await pool.query(`DELETE FROM team WHERE id IN ($1, $2)`, [HOME, AWAY]);
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`nw_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('lists the latest newest first, carries only what the source grants, and pages by the cursor', async () => {
    const { status, body } = await section('section=latest');
    expect(status).toBe(200);
    expect(body.stories.coverage).toBe('available');
    const ours = body.stories.data!.filter(
      (c) => c.story_id === matchStory || c.story_id === otherStory,
    );
    expect(ours.map((c) => c.story_id)).toEqual([otherStory, matchStory]);
    const match = ours[1]!;
    expect(match).toMatchObject({
      headline: `Rovers edge Athletic ${RUN}`,
      summary: 'What the publisher wrote.',
      language: 'en',
      published_at: '2026-09-17T16:00:00.000Z',
      source: { name: `Sections ${RUN}`, rights: 'summary' },
      other_reports: 0,
      discussion: null,
      debate: null,
    });
    expect(match.entities.map((e) => [e.entity_type, e.name])).toEqual(
      expect.arrayContaining([
        ['team', `Testville Rovers ${RUN}`],
        ['team', `Otherton Athletic ${RUN}`],
        ['fixture', null],
      ]),
    );
    expect(Object.keys(match)).not.toContain('body');

    const older = await section(
      `section=latest&before=${encodeURIComponent('2026-09-18T00:00:00Z')}`,
    );
    const ids = older.body.stories.data!.map((c) => c.story_id);
    expect(ids).toContain(matchStory);
    expect(ids).not.toContain(otherStory);
  });

  it('filters by team, by country and by language, and refuses a filter that is not an id', async () => {
    const byTeam = await section(`section=latest&team=${HOME}`);
    expect(byTeam.body.stories.data!.map((c) => c.story_id)).toEqual([matchStory]);
    const byCountry = await section(`section=latest&country=${ENGLAND}`);
    const countryIds = byCountry.body.stories.data!.map((c) => c.story_id);
    expect(countryIds).toContain(matchStory);
    expect(countryIds).not.toContain(otherStory);
    const french = await section('section=latest&language=fr');
    const frenchIds = french.body.stories.data!.map((c) => c.story_id);
    expect(frenchIds).toContain(otherStory);
    expect(frenchIds).not.toContain(matchStory);
    expect(french.body.stories.data!.every((c) => c.language === 'fr')).toBe(true);
    const nothing = await section(`section=latest&team=${randomUUID()}`);
    expect(nothing.body.stories.data).toEqual([]);
    expect(nothing.body.reason).toBe('no_match');
    expect((await section('section=latest&team=arsenal')).status).toBe(400);
    expect((await section('section=opinion')).status).toBe(400);
  });

  it('ranks trending by distinct members in the public discussion, and says that is all it counts', async () => {
    const before = await section('section=trending');
    expect(before.body.stories.coverage).toBe('limited');
    expect(before.body.stories.data!.map((c) => c.story_id)).not.toContain(matchStory);

    const one = await register(`nw_${RUN}a`);
    const two = await register(`nw_${RUN}b`);
    const client = await pool.connect();
    try {
      // The approval, sanction and open-panel guards are the panel's own tests; here the signal is the fixture.
      await client.query(`SET session_replication_role = replica`);
      const post = await client.query<{ id: string }>(
        `INSERT INTO panel_post (fixture_id, author_id, body) VALUES ($1, $2, 'What a finish.') RETURNING id`,
        [MATCH, one.id],
      );
      await client.query(
        `INSERT INTO panel_post (fixture_id, author_id, body) VALUES ($1, $2, 'Offside, surely.')`,
        [MATCH, one.id],
      );
      await client.query(
        `INSERT INTO panel_reaction (post_id, user_id, reaction) VALUES ($1, $2, 'agree')`,
        [post.rows[0]!.id, two.id],
      );
      await client.query(`RESET session_replication_role`);
    } finally {
      client.release();
    }

    const after = await section('section=trending');
    expect(after.body.stories.coverage).toBe('limited');
    expect(after.body.reason).toBe('discussion_only');
    const card = after.body.stories.data!.find((c) => c.story_id === matchStory);
    expect(card?.discussion).toEqual({ participants: 2, window_hours: 48 });
    expect(after.body.stories.data!.map((c) => c.story_id)).not.toContain(otherStory);
  });

  it('shows debate as what an editor selected, and nothing -- said so -- when nobody has', async () => {
    const empty = await section(`section=debate&team=${HOME}`);
    expect(empty.body.stories.data).toEqual([]);
    expect(empty.body.reason).toBe('no_match');
    const editor = members.get(`nw_${RUN}a`) ?? (await register(`nw_${RUN}a`));
    await pool.query(
      `INSERT INTO story_debate (story_id, selected_by, note) VALUES ($1, $2, 'Was it a penalty?')`,
      [matchStory, editor.id],
    );
    const selected = await section('section=debate');
    const card = selected.body.stories.data!.find((c) => c.story_id === matchStory);
    expect(card?.debate).toMatchObject({ note: 'Was it a penalty?' });
    expect(selected.body.stories.data!.map((c) => c.story_id)).not.toContain(otherStory);
    await pool.query(
      `UPDATE story_debate SET cleared_at = now(), cleared_by = $2, cleared_reason = 'settled'
        WHERE story_id = $1`,
      [matchStory, editor.id],
    );
    const cleared = await section('section=debate');
    expect(cleared.body.stories.data!.map((c) => c.story_id)).not.toContain(matchStory);
  });

  it('answers following from what the member follows, and tells a guest it needs a session', async () => {
    const guest = await section('section=following');
    expect(guest.status).toBe(200);
    expect(guest.body.stories).toMatchObject({ coverage: 'not_supplied', data: null });
    expect(guest.body.reason).toBe('needs_session');

    const member = await register(`nw_${RUN}c`);
    const nothing = await section('section=following', member.cookie);
    expect(nothing.body.stories.data).toEqual([]);
    expect(nothing.body.reason).toBe('nothing_followed');

    await pool.query(
      `INSERT INTO followed_entity (user_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
      [member.id, AWAY],
    );
    const followed = await section('section=following', member.cookie);
    expect(followed.body.stories.coverage).toBe('available');
    expect(followed.body.stories.data!.map((c) => c.story_id)).toEqual([matchStory]);
  });
});
