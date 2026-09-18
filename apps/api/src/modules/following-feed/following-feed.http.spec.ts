import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FeedItem, FollowingFeed } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { FollowingFeedModule } from './following-feed.module';
import { rank } from './following-feed.service';

/**
 * The Following feed (T-333, blueprint 12.1) over the real tables: a member
 * follows one club as a favourite and one competition, and follows one
 * contributor; around them are a match tomorrow, a story, the founder's
 * analysis and the contributor's post. Every item says why it is there; the
 * ranking is the signals added up, so the favourite's imminent match comes
 * first; the feed says what window and what kinds it shows; a guest is
 * refused and a member who follows nothing is told so, not shown a blank.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const HOME = randomUUID();
const AWAY = randomUUID();
const MATCH = randomUUID();

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the Following feed', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let source = '';
  let storyId = '';
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

  const feedOf = async (who: string): Promise<{ status: number; body: FollowingFeed }> => {
    const response = await app.inject({
      method: 'GET',
      url: '/me/feed',
      headers: { cookie: `fmip_session=${cookies.get(who) ?? ''}` },
    });
    return { status: response.statusCode, body: response.json<FollowingFeed>() };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, FollowingFeedModule],
    })
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

    await register(`ff_${RUN}m`);
    await register(`ff_${RUN}c`);
    await register(`ff_${RUN}n`);
    const member = ids.get(`ff_${RUN}m`)!;
    const contributor = ids.get(`ff_${RUN}c`)!;

    await pool.query(
      `INSERT INTO team (id, country_id, name, short_name, kind, gender)
       VALUES ($1, $3, $4, 'FFH', 'club', 'men'), ($2, $3, $5, 'FFA', 'club', 'men')`,
      [HOME, AWAY, ENGLAND, `Feed Home ${RUN}`, `Feed Away ${RUN}`],
    );
    await pool.query(
      `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
       VALUES ($1, $2, $3, 'Matchday 12', now() + interval '12 hours', 'scheduled')`,
      [MATCH, PL_2025, REGULAR_SEASON],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [MATCH, HOME, AWAY],
    );
    await pool.query(
      `INSERT INTO followed_entity (user_id, entity_type, entity_id, favourite)
       VALUES ($1, 'team', $2, true), ($1, 'competition', $3, false)`,
      [member, HOME, PREMIER_LEAGUE],
    );
    await pool.query(`INSERT INTO member_follow (follower_id, followed_id) VALUES ($1, $2)`, [
      member,
      contributor,
    ]);

    const src = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
       VALUES ($1, 'https://scripted.test', $2, 'rss', 'summary', 'en') RETURNING id`,
      [`Feed Source ${RUN}`, `https://scripted.test/feed-${RUN}.xml`],
    );
    source = src.rows[0]!.id;
    const story = await pool.query<{ id: string }>(`INSERT INTO story DEFAULT VALUES RETURNING id`);
    storyId = story.rows[0]!.id;
    const article = await pool.query<{ id: string }>(
      `INSERT INTO article (source_id, story_id, external_id, url)
       VALUES ($1, $2, $3, 'https://scripted.test/home-news') RETURNING id`,
      [source, storyId, `home-news-${RUN}`],
    );
    await pool.query(
      `INSERT INTO article_version (article_id, language, version_number, headline, published_at)
       VALUES ($1, 'en', 1, $2, now() - interval '2 hours')`,
      [article.rows[0]!.id, `Feed Home ${RUN} name their side`],
    );
    await pool.query(
      `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, 'team', $2)`,
      [article.rows[0]!.id, HOME],
    );
    await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
      storyId,
      article.rows[0]!.id,
    ]);

    const analysis = await pool.query<{ id: string }>(
      `INSERT INTO founder_analysis (fixture_id, author_id) VALUES ($1, $2) RETURNING id`,
      [MATCH, contributor],
    );
    await pool.query(
      `INSERT INTO founder_analysis_version
         (analysis_id, version_number, predicted_outcome, confidence, reasoning, published_at)
       VALUES ($1, 1, 'home', 3, 'The home side are in form.', now() - interval '3 hours')`,
      [analysis.rows[0]!.id],
    );

    const client = await pool.connect();
    try {
      // The panel's guards are its own tests; here the post is the fact.
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(
        `INSERT INTO panel_post (fixture_id, author_id, body) VALUES ($1, $2, $3)`,
        [MATCH, contributor, 'Expect a cagey first half.'],
      );
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM panel_post WHERE fixture_id = $1`, [MATCH]);
      await client.query(
        `DELETE FROM founder_analysis_version WHERE analysis_id IN (SELECT id FROM founder_analysis WHERE fixture_id = $1)`,
        [MATCH],
      );
      await client.query(`DELETE FROM founder_analysis WHERE fixture_id = $1`, [MATCH]);
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
    await pool.query(`DELETE FROM story WHERE id = $1`, [storyId]);
    await pool.query(`DELETE FROM fixture WHERE id = $1`, [MATCH]);
    await pool.query(`DELETE FROM team WHERE id IN ($1, $2)`, [HOME, AWAY]);
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`ff_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it("is a member's own, and tells a member who follows nothing so rather than showing a blank", async () => {
    const guest = await app.inject({ method: 'GET', url: '/me/feed' });
    expect(guest.statusCode).toBe(401);
    const nobody = await feedOf(`ff_${RUN}n`);
    expect(nobody.status).toBe(200);
    expect(nobody.body.items).toEqual([]);
    expect(nobody.body.reason).toBe('nothing_followed');
    expect(nobody.body.showing.followed).toEqual({ teams: 0, competitions: 0, members: 0 });
  });

  it('shows the match, the story, the analysis and the post, each saying why, ranked from the signals', async () => {
    const { status, body } = await feedOf(`ff_${RUN}m`);
    expect(status).toBe(200);
    expect(body.reason).toBeNull();
    expect(body.ranking.version).toBe('feed-rank@1');
    expect(body.ranking.signals).not.toContain('views');
    expect(body.showing.kinds).toEqual(['fixture', 'story', 'founder_analysis', 'panel_post']);
    expect(body.showing.followed).toEqual({ teams: 1, competitions: 1, members: 1 });

    const mine = body.items.filter(
      (i) =>
        ('fixture_id' in i && i.fixture_id === MATCH) ||
        ('story_id' in i && i.story_id === storyId),
    );
    expect(mine.map((i) => i.kind).sort()).toEqual(
      ['fixture', 'founder_analysis', 'panel_post', 'story'].sort(),
    );
    for (const item of mine) {
      expect(item.because.length, item.kind).toBeGreaterThan(0);
      expect(item.because[0]?.kind, item.kind).toBe('follows');
      expect(item.rank, item.kind).toBe(rank(item.because));
    }

    const match = mine.find((i) => i.kind === 'fixture') as FeedItem & { kind: 'fixture' };
    expect(match.because).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'follows', entity_type: 'team', name: `Feed Home ${RUN}` }),
        expect.objectContaining({ kind: 'favourite', name: `Feed Home ${RUN}` }),
        expect.objectContaining({
          kind: 'follows',
          entity_type: 'competition',
          name: 'Premier League',
        }),
        expect.objectContaining({ kind: 'imminent' }),
      ]),
    );
    // A follow is inclusion; the favourite and the kick-off tomorrow are the rank.
    expect(match.rank).toBe(4);
    // Before kick-off there is no score, and the rank never masquerades as one.
    expect(match.score).toBeNull();
    // Ranked above the story, which is a favourite's and fresh: 2 + 1.
    const story = mine.find((i) => i.kind === 'story')!;
    expect(story.rank).toBe(3);
    expect(body.items.indexOf(match)).toBeLessThan(body.items.indexOf(story));
    const post = mine.find((i) => i.kind === 'panel_post') as FeedItem & { kind: 'panel_post' };
    expect(post.because).toEqual([
      expect.objectContaining({ kind: 'follows', entity_type: 'member' }),
      expect.objectContaining({ kind: 'fresh' }),
    ]);
    expect(post.excerpt).toBe('Expect a cagey first half.');
  });
});
