import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { notificationLine, notificationPath } from '@fmip/contracts';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { PostgresNotificationsStore } from '../notifications/internal/notifications-store';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { NewsModule } from './news.module';

/**
 * The breaking alert (T-1005, D-125), through the editor's real mark: opt-in,
 * to followers of a team, competition or person the story links, once per
 * story however often it is marked, deep-linked to the story, with the mutes
 * and quiet hours of every other kind. A story that links nothing a member
 * follows reaches nobody.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
const TEAM = randomUUID();
const OTHER_TEAM = randomUUID();
const PERSON = randomUUID();

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

/** `HH:MM` in UTC, `minutes` from now. */
function clock(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString().slice(11, 16);
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('breaking alert', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let source: string;
  let editorCookie = '';
  let editorId = '';
  let notificationsStore: PostgresNotificationsStore;
  const stories: string[] = [];
  const members = new Map<string, string>();

  async function member(name: string, wantsBreaking: boolean): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO user_account
         (username, display_name, email, country_id, preferred_language, timezone,
          accepted_rules_at, email_verified_at)
       VALUES ($1, $2, $3, $4, 'en', 'UTC', now(), now())
       RETURNING id`,
      [`ba${name}${RUN}`, `Member ${name}`, `ba${name}${RUN}@example.test`, ENGLAND],
    );
    const id = rows[0]!.id;
    members.set(name, id);
    if (wantsBreaking) {
      await pool.query(
        `INSERT INTO notification_preference (user_id, kind, in_product)
         VALUES ($1, 'breaking_news', true)`,
        [id],
      );
    }
    return id;
  }

  const follow = (userId: string, type: string, entityId: string) =>
    pool.query(
      `INSERT INTO followed_entity (user_id, entity_type, entity_id) VALUES ($1, $2, $3)`,
      [userId, type, entityId],
    );

  async function story(links: { type: string; id: string }[]): Promise<string> {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO story DEFAULT VALUES RETURNING id`,
    );
    const storyId = rows[0]!.id;
    stories.push(storyId);
    const article = await pool.query<{ id: string }>(
      `INSERT INTO article (source_id, story_id, external_id, url)
       VALUES ($1, $2, $3, $4) RETURNING id`,
      [source, storyId, `alert-${storyId}`, `https://scripted.test/${storyId}`],
    );
    await pool.query(
      `INSERT INTO article_version (article_id, language, version_number, headline, published_at)
       VALUES ($1, 'en', 1, $2, now())`,
      [article.rows[0]!.id, `Alert story ${RUN}`],
    );
    for (const link of links) {
      await pool.query(
        `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, $2, $3)`,
        [article.rows[0]!.id, link.type, link.id],
      );
    }
    await pool.query(`UPDATE story SET promoted_article_id = $2 WHERE id = $1`, [
      storyId,
      article.rows[0]!.id,
    ]);
    return storyId;
  }

  const act = (storyId: string, path: string, payload: Record<string, unknown>) =>
    app.inject({
      method: 'POST',
      url: `/admin/stories/${storyId}/${path}`,
      headers: { cookie: `fmip_session=${editorCookie}` },
      payload,
    });

  const told = (storyId: string) =>
    pool.query<{
      user_id: string;
      subject_type: string;
      held: boolean;
    }>(
      `SELECT user_id, subject_type, deliver_after > created_at AS held
         FROM notification WHERE kind = 'breaking_news' AND subject_id = $1
        ORDER BY user_id`,
      [storyId],
    );

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
    notificationsStore = moduleRef.get(PostgresNotificationsStore, { strict: false });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });

    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: `ba_${RUN}e`,
        display_name: 'Editor',
        email: `ba_${RUN}e@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'UTC',
        accept_rules: true,
      },
    });
    expect(registered.statusCode).toBe(201);
    editorCookie = cookieValue(registered.headers['set-cookie']);
    const editor = await pool.query<{ id: string }>(
      `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
      [`ba_${RUN}e`],
    );
    editorId = editor.rows[0]!.id;
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'editor', $1, 'the breaking alert test')`,
      [editorId],
    );

    await pool.query(
      `INSERT INTO team (id, country_id, name, short_name, kind, gender)
       VALUES ($1, $3, $4, 'BAT', 'club', 'men'), ($2, $3, $5, 'BAO', 'club', 'men')`,
      [TEAM, OTHER_TEAM, ENGLAND, `Alert Town ${RUN}`, `Elsewhere ${RUN}`],
    );
    await pool.query(`INSERT INTO person (id, full_name, known_as) VALUES ($1, $2, NULL)`, [
      PERSON,
      `Alert Striker ${RUN}`,
    ]);
    const src = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
       VALUES ($1, 'https://scripted.test', $2, 'rss', 'headline', 'en') RETURNING id`,
      [`Alerts ${RUN}`, `https://scripted.test/alerts-${RUN}.xml`],
    );
    source = src.rows[0]!.id;

    await follow(await member('team', true), 'team', TEAM);
    await follow(await member('default', false), 'team', TEAM);
    await follow(await member('person', true), 'person', PERSON);
    await follow(await member('comp', true), 'competition', PREMIER_LEAGUE);
    await follow(await member('other', true), 'team', OTHER_TEAM);
    const muted = await member('muted', true);
    await follow(muted, 'team', TEAM);
    await pool.query(
      `INSERT INTO notification_mute (user_id, scope, target) VALUES ($1, 'team', $2)`,
      [muted, TEAM],
    );
    const quiet = await member('quiet', true);
    await follow(quiet, 'team', TEAM);
    await pool.query(`INSERT INTO quiet_hours (user_id, starts_at, ends_at) VALUES ($1, $2, $3)`, [
      quiet,
      clock(-60),
      clock(60),
    ]);
  });

  afterAll(async () => {
    const ids = [...members.values()];
    await pool.query(`DELETE FROM notification WHERE subject_id = ANY($1::text[])`, [stories]);
    await withTriggersOff(pool, async (client) => {
      await client.query(
        `DELETE FROM audit_log WHERE target_type = 'story' AND target_id = ANY($1::text[])`,
        [stories],
      );
    });
    await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
    await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [stories]);
    await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [[...ids, editorId]]);
    await pool.query(`DELETE FROM person WHERE id = $1`, [PERSON]);
    await pool.query(`DELETE FROM team WHERE id IN ($1, $2)`, [TEAM, OTHER_TEAM]);
    await pool.end();
    await app.close();
  });

  it('tells the opted-in followers of what the story links, once, under their mutes and quiet hours', async () => {
    const storyId = await story([
      { type: 'team', id: TEAM },
      { type: 'competition', id: PREMIER_LEAGUE },
      { type: 'person', id: PERSON },
    ]);
    expect(
      (await act(storyId, 'breaking', { note: 'Striker injured in training.' })).statusCode,
    ).toBe(204);

    const rows = (await told(storyId)).rows;
    const byName = new Map([...members.entries()].map(([name, id]) => [id, name] as const));
    expect(rows.map((r) => byName.get(r.user_id)).sort()).toEqual([
      'comp',
      'person',
      'quiet',
      'team',
    ]);
    // Not 'default' (off by default), not 'other' (follows nothing linked),
    // not 'muted' (a team mute silences a story about the team).
    expect(rows.every((r) => r.subject_type === 'story')).toBe(true);
    // Quiet hours delay and never drop.
    expect(rows.find((r) => byName.get(r.user_id) === 'quiet')?.held).toBe(true);
    expect(rows.find((r) => byName.get(r.user_id) === 'team')?.held).toBe(false);

    // The line is the editor's note, and it opens the story.
    const inbox = await pool.query<{ kind: 'breaking_news'; subject_id: string }>(
      `SELECT kind, subject_id FROM notification
        WHERE kind = 'breaking_news' AND subject_id = $1 AND user_id = $2`,
      [storyId, members.get('team')],
    );
    expect(
      notificationPath('en', {
        subject_type: 'story',
        subject_id: inbox.rows[0]!.subject_id,
        subject_label: null,
        kind: 'breaking_news',
      }),
    ).toBe(`/en/news/story/${storyId}`);
    // The inbox's line is the editor's note, read from the mark.
    const inboxRows = await notificationsStore.inbox(members.get('team')!, 20);
    const line = inboxRows.find((n) => n.kind === 'breaking_news' && n.subject_id === storyId);
    expect(line?.headline).toBe('Breaking: Striker injured in training.');
    expect(
      notificationLine({ kind: 'breaking_news', source: null, headline: line!.headline }),
    ).toBe('Breaking: Striker injured in training.');
  });

  it('tells nobody twice when a story is marked, cleared and marked again', async () => {
    const storyId = await story([{ type: 'team', id: TEAM }]);
    expect((await act(storyId, 'breaking', { note: 'Deal agreed.' })).statusCode).toBe(204);
    expect((await act(storyId, 'breaking/clear', { reason: 'Not confirmed.' })).statusCode).toBe(
      204,
    );
    expect((await act(storyId, 'breaking', { note: 'Deal confirmed.' })).statusCode).toBe(204);
    const rows = (await told(storyId)).rows;
    const ids = rows.map((r) => r.user_id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain(members.get('team'));
  });

  it('reaches nobody when the story links nothing a member follows', async () => {
    const storyId = await story([]);
    expect((await act(storyId, 'breaking', { note: 'Something happened.' })).statusCode).toBe(204);
    expect((await told(storyId)).rows).toEqual([]);
  });
});
