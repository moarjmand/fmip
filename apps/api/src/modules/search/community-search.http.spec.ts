import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { SearchResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { SearchModule } from './search.module';

// T-642 acceptance: a private profile is never a result. Nor is a
// friends-only one, a suspended account, anybody on either side of a block
// with the viewer, an invite-only group, or a story whose publisher was
// dropped. Every row carries the run suffix, so the query matches this
// suite's rows and nobody else's.
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const TERM = `quokka ${RUN}`;

const options: IdentityOptions = {
  ...DEFAULT_IDENTITY_OPTIONS,
  sessionSecret: 'test-secret-'.repeat(4),
  webBaseUrl: 'http://web.test',
  cookieSecure: false,
};

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('community search', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const ids = new Map<string, string>();
  const cookies = new Map<string, string>();
  const groupIds: string[] = [];
  const sources: string[] = [];
  const stories: string[] = [];

  const name = (who: string) => `cs_${RUN}${who}`;

  const register = async (who: string, display: string) => {
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: name(who),
        display_name: display,
        email: `${name(who)}@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    expect(response.statusCode).toBe(201);
    cookies.set(who, cookieValue(response.headers['set-cookie']));
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM user_account WHERE username = $1`,
      [name(who)],
    );
    ids.set(who, rows[0]!.id);
  };

  const search = async (query: string, who?: string): Promise<SearchResponse> => {
    const cookie = who === undefined ? undefined : cookies.get(who);
    const response = await app.inject({
      method: 'GET',
      url: `/search?${query}`,
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });
    expect(response.statusCode).toBe(200);
    return response.json() as SearchResponse;
  };

  const group = async (slug: string, title: string, visibility: string) => {
    const client = await pool.connect();
    try {
      // The way the groups store makes one: the group, its owner and its
      // conversation in one transaction, because the owner rule is checked at
      // commit.
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO user_group (slug, name, visibility, created_by)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [slug, title, visibility, ids.get('owner')],
      );
      const id = rows[0]!.id;
      await client.query(
        `INSERT INTO group_member (group_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [id, ids.get('owner')],
      );
      await client.query(`INSERT INTO conversation (kind, group_id) VALUES ('group', $1)`, [id]);
      await client.query('COMMIT');
      groupIds.push(id);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  };

  const story = async (source: string, headline: string, language = 'en') => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO story DEFAULT VALUES RETURNING id`,
    );
    const storyId = rows[0]!.id;
    stories.push(storyId);
    const article = await pool.query<{ id: string }>(
      `INSERT INTO article (source_id, story_id, external_id, url)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [source, storyId, `cs-${storyId}`, `https://scripted.test/${storyId}`],
    );
    await pool.query(
      `INSERT INTO article_version (article_id, language, version_number, headline, published_at)
       VALUES ($1, $2, 1, $3, '2026-09-20T10:00:00Z')`,
      [article.rows[0]!.id, language, headline],
    );
    await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
      storyId,
      article.rows[0]!.id,
    ]);
    return storyId;
  };

  const newsSource = async (label: string, dropped: boolean) => {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language, dropped_at, dropped_reason)
       VALUES ($1, 'https://scripted.test', $2, 'rss', 'headline', 'en',
               CASE WHEN $3 THEN now() END, CASE WHEN $3 THEN 'terms changed' END)
       RETURNING id`,
      [`${label} ${RUN}`, `https://scripted.test/${label}-${RUN}.xml`, dropped],
    );
    sources.push(rows[0]!.id);
    return rows[0]!.id;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, SearchModule],
    })
      .overrideProvider(MAILER)
      .useValue(new CaptureMailer())
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue(options)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });

    await register('viewer', `Viewer ${RUN}`);
    await register('pub', `Quokka ${RUN} Public`);
    await register('friends', `Quokka ${RUN} Friends`);
    await register('priv', `Quokka ${RUN} Private`);
    await register('susp', `Quokka ${RUN} Suspended`);
    await register('blocker', `Quokka ${RUN} Blocker`);
    await register('blocked', `Quokka ${RUN} Blocked`);
    await register('owner', `Owner ${RUN}`);

    await pool.query(
      `INSERT INTO privacy_setting (user_id, profile_visibility) VALUES ($1, 'friends'), ($2, 'private')`,
      [ids.get('friends'), ids.get('priv')],
    );
    await pool.query(`UPDATE user_account SET status = 'suspended' WHERE id = $1`, [
      ids.get('susp'),
    ]);
    await pool.query(`INSERT INTO user_block (blocker_id, blocked_id) VALUES ($1, $2), ($3, $1)`, [
      ids.get('viewer'),
      ids.get('blocked'),
      ids.get('blocker'),
    ]);

    await group(`qk-${RUN}-pub`, `Quokka ${RUN} Open`, 'public');
    await group(`qk-${RUN}-disc`, `Quokka ${RUN} Findable`, 'discoverable');
    await group(`qk-${RUN}-inv`, `Quokka ${RUN} Hidden`, 'invite_only');

    const live = await newsSource('Live', false);
    const gone = await newsSource('Gone', true);
    await story(live, `Quökka ${RUN} win the derby`);
    await story(gone, `Quokka ${RUN} report from a dropped publisher`);
  });

  afterAll(async () => {
    await withTriggersOff(pool, async (client) => {
      await client.query(`DELETE FROM conversation WHERE group_id = ANY($1::uuid[])`, [groupIds]);
      await client.query(`DELETE FROM group_member WHERE group_id = ANY($1::uuid[])`, [groupIds]);
      await client.query(`DELETE FROM user_group WHERE id = ANY($1::uuid[])`, [groupIds]);
      await client.query(`DELETE FROM rate_window WHERE user_id = ANY($1::uuid[])`, [
        [...ids.values()],
      ]);
    });
    await pool.query(`DELETE FROM news_source WHERE id = ANY($1::uuid[])`, [sources]);
    await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`cs\\_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  const q = `q=${encodeURIComponent(TERM)}`;

  it('never finds a private, friends-only or suspended member, for a guest or anybody signed in', async () => {
    for (const who of [undefined, 'viewer', 'pub']) {
      const members = (await search(q, who)).members ?? [];
      const usernames = members.map((m) => m.username);
      expect(usernames, String(who)).not.toContain(name('priv'));
      expect(usernames, String(who)).not.toContain(name('friends'));
      expect(usernames, String(who)).not.toContain(name('susp'));
    }
    // The private member cannot find themselves either: "never a result" has no owner exception.
    const own = (await search(q, 'priv')).members ?? [];
    expect(own.map((m) => m.username)).not.toContain(name('priv'));
  });

  it('finds a public member by display name or username, with nothing but the two names', async () => {
    const guest = await search(q);
    expect(guest.members).toContainEqual({
      username: name('pub'),
      display_name: `Quokka ${RUN} Public`,
      score: 1,
    });
    const byUsername = await search(`q=${name('pub')}&types=member`);
    expect(byUsername.members?.map((m) => m.username)).toContain(name('pub'));
  });

  it('hides both sides of a block from each other, and from nobody else', async () => {
    const asViewer = (await search(q, 'viewer')).members?.map((m) => m.username) ?? [];
    expect(asViewer).toContain(name('pub'));
    expect(asViewer).not.toContain(name('blocked'));
    expect(asViewer).not.toContain(name('blocker'));

    const asGuest = (await search(q)).members?.map((m) => m.username) ?? [];
    expect(asGuest).toEqual(expect.arrayContaining([name('blocked'), name('blocker')]));
  });

  it('finds public and discoverable groups and never an invite-only one', async () => {
    for (const who of [undefined, 'viewer', 'owner']) {
      const groups = ((await search(q, who)).groups ?? []).filter((g) => g.slug.includes(RUN));
      expect(groups.map((g) => g.slug).sort(), String(who)).toEqual(
        [`qk-${RUN}-disc`, `qk-${RUN}-pub`].sort(),
      );
    }
    const found = (await search(q)).groups ?? [];
    expect(found.find((g) => g.slug === `qk-${RUN}-disc`)).toMatchObject({
      name: `Quokka ${RUN} Findable`,
      visibility: 'discoverable',
      member_count: 1,
    });
  });

  it('finds a story by its headline with accents folded, never one from a dropped source', async () => {
    const found = ((await search(q)).stories ?? []).filter((s) => stories.includes(s.story_id));
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({
      story_id: stories[0],
      headline: `Quökka ${RUN} win the derby`,
      language: 'en',
      source_name: `Live ${RUN}`,
      url: `https://scripted.test/${stories[0]}`,
      published_at: '2026-09-20T10:00:00.000Z',
    });
  });

  it('answers null for a kind nobody asked for, and keeps the catalog list its own', async () => {
    const onlyGroups = await search(`${q}&types=group`);
    expect(onlyGroups.types).toEqual(['group']);
    expect(onlyGroups.results).toEqual([]);
    expect(onlyGroups.stories).toBeNull();
    expect(onlyGroups.members).toBeNull();
    expect(onlyGroups.groups?.filter((g) => g.slug.includes(RUN))).toHaveLength(2);

    const entitiesOnly = await search(`${q}&types=team,person`);
    expect(entitiesOnly.stories).toBeNull();
    expect(entitiesOnly.groups).toBeNull();
    expect(entitiesOnly.members).toBeNull();
  });
});
