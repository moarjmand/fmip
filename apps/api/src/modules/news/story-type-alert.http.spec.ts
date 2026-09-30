import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { NOTIFICATION_DEFAULTS, notificationLine, notificationPath } from '@fmip/contracts';
import type { Transport, TransportResponse } from '@fmip/ingestion';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { PostgresNotificationsStore } from '../notifications/internal/notifications-store';
import { NEWS_TRANSPORT } from './internal/news-transport';
import { CATEGORY_MAPPING, type CategoryMapping } from './internal/story-type-mapping';
import { NewsIngestionService } from './news-ingestion.service';
import { NewsModule } from './news.module';

/**
 * Transfer and availability alerts (T-1032, D-166), through the editor's real
 * type endpoint and the feed reader's real publisher labelling: opt-in, to
 * followers of a team or person the story links (a competition is not
 * enough), once per story and kind however often its type is rewritten,
 * deep-linked to the story, with the mutes and quiet hours of every kind. A
 * type that is not transfer, injury or suspension tells nobody.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
const TEAM = randomUUID();
const OTHER_TEAM = randomUUID();
const PERSON = randomUUID();
const HOST = `sta-${RUN}.scripted.test`;
const FEED = `https://${HOST}/feed.xml`;

const MAPPING: readonly CategoryMapping[] = [
  { host: HOST, category: 'Transfers', type: 'transfer', recorded: 'spec-only' },
  { host: HOST, category: 'Opinion', type: 'opinion', recorded: 'spec-only' },
];

class ScriptedTransport implements Transport {
  body = '';
  async request(url: string): Promise<TransportResponse> {
    const hit = url === FEED ? { status: 200, body: this.body } : { status: 404, body: 'no' };
    return { ...hit, receivedAt: new Date().toISOString() };
  }
}

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

/** `HH:MM` in UTC, `minutes` from now. */
function clock(minutes: number): string {
  return new Date(Date.now() + minutes * 60_000).toISOString().slice(11, 16);
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('story type alerts', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let source: string;
  let editorCookie = '';
  let editorId = '';
  let notificationsStore: PostgresNotificationsStore;
  let ingestion: NewsIngestionService;
  const transport = new ScriptedTransport();
  const stories: string[] = [];
  const members = new Map<string, string>();

  async function member(name: string, wants: ('transfer_news' | 'availability_news')[]) {
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO user_account
         (username, display_name, email, country_id, preferred_language, timezone,
          accepted_rules_at, email_verified_at)
       VALUES ($1, $2, $3, $4, 'en', 'UTC', now(), now())
       RETURNING id`,
      [`st${name}${RUN}`, `Member ${name}`, `st${name}${RUN}@example.test`, ENGLAND],
    );
    const id = rows[0]!.id;
    members.set(name, id);
    for (const kind of wants) {
      await pool.query(
        `INSERT INTO notification_preference (user_id, kind, in_product) VALUES ($1, $2, true)`,
        [id, kind],
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
      [source, storyId, `sta-${storyId}`, `https://${HOST}/${storyId}`],
    );
    await pool.query(
      `INSERT INTO article_version (article_id, language, version_number, headline, published_at)
       VALUES ($1, 'en', 1, 'First words', now()), ($1, 'en', 2, $2, now())`,
      [article.rows[0]!.id, `Striker signs ${RUN}`],
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

  const type = (storyId: string, given: string) =>
    app.inject({
      method: 'POST',
      url: `/admin/stories/${storyId}/type`,
      headers: { cookie: `fmip_session=${editorCookie}` },
      payload: { type: given, reason: 'The spec says so.' },
    });

  const told = (storyId: string, kind: string) =>
    pool.query<{ user_id: string; subject_type: string; held: boolean }>(
      `SELECT user_id, subject_type, deliver_after > created_at AS held
         FROM notification WHERE kind = $2 AND subject_id = $1
        ORDER BY user_id`,
      [storyId, kind],
    );

  const names = (rows: { user_id: string }[]): string[] => {
    const byId = new Map([...members.entries()].map(([name, id]) => [id, name] as const));
    return rows.map((r) => byId.get(r.user_id) ?? r.user_id).sort();
  };

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
      .overrideProvider(NEWS_TRANSPORT)
      .useValue(transport)
      .overrideProvider(CATEGORY_MAPPING)
      .useValue(MAPPING)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    notificationsStore = moduleRef.get(PostgresNotificationsStore, { strict: false });
    ingestion = moduleRef.get(NewsIngestionService);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });

    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: `st_${RUN}e`,
        display_name: 'Editor',
        email: `st_${RUN}e@example.test`,
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
      [`st_${RUN}e`],
    );
    editorId = editor.rows[0]!.id;
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'editor', $1, 'the story type alert test')`,
      [editorId],
    );

    await pool.query(
      `INSERT INTO team (id, country_id, name, short_name, kind, gender)
       VALUES ($1, $3, $4, 'STT', 'club', 'men'), ($2, $3, $5, 'STO', 'club', 'men')`,
      [TEAM, OTHER_TEAM, ENGLAND, `Typed Town ${RUN}`, `Elsewhere ${RUN}`],
    );
    await pool.query(`INSERT INTO person (id, full_name, known_as) VALUES ($1, $2, NULL)`, [
      PERSON,
      `Typed Striker ${RUN}`,
    ]);
    const src = await pool.query<{ id: string }>(
      `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
       VALUES ($1, $2, $3, 'rss', 'headline', 'en') RETURNING id`,
      [`Typed ${RUN}`, `https://${HOST}`, FEED],
    );
    source = src.rows[0]!.id;

    const both = ['transfer_news', 'availability_news'] as const;
    await follow(await member('team', [...both]), 'team', TEAM);
    await follow(await member('transfers', ['transfer_news']), 'team', TEAM);
    await follow(await member('default', []), 'team', TEAM);
    await follow(await member('person', [...both]), 'person', PERSON);
    await follow(await member('comp', [...both]), 'competition', PREMIER_LEAGUE);
    await follow(await member('other', [...both]), 'team', OTHER_TEAM);
    const muted = await member('muted', [...both]);
    await follow(muted, 'team', TEAM);
    await pool.query(
      `INSERT INTO notification_mute (user_id, scope, target) VALUES ($1, 'team', $2)`,
      [muted, TEAM],
    );
    const quiet = await member('quiet', [...both]);
    await follow(quiet, 'team', TEAM);
    await pool.query(`INSERT INTO quiet_hours (user_id, starts_at, ends_at) VALUES ($1, $2, $3)`, [
      quiet,
      clock(-60),
      clock(60),
    ]);
  });

  afterAll(async () => {
    const fetched = await pool.query<{ story_id: string }>(
      `SELECT story_id FROM article WHERE source_id = $1`,
      [source],
    );
    const all = [...new Set([...stories, ...fetched.rows.map((r) => r.story_id)])];
    await pool.query(`DELETE FROM notification WHERE subject_id = ANY($1::text[])`, [all]);
    await withTriggersOff(pool, async (client) => {
      await client.query(
        `DELETE FROM audit_log WHERE target_type = 'story' AND target_id = ANY($1::text[])`,
        [all],
      );
    });
    await pool.query(`DELETE FROM news_source WHERE id = $1`, [source]);
    await pool.query(`DELETE FROM story WHERE id = ANY($1::uuid[])`, [all]);
    await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [
      [...members.values(), editorId],
    ]);
    await pool.query(`DELETE FROM person WHERE id = $1`, [PERSON]);
    await pool.query(`DELETE FROM team WHERE id IN ($1, $2)`, [TEAM, OTHER_TEAM]);
    await pool.end();
    await app.close();
  });

  it('is off by default, like breaking news', () => {
    expect(NOTIFICATION_DEFAULTS.transfer_news).toBe(false);
    expect(NOTIFICATION_DEFAULTS.availability_news).toBe(false);
  });

  it('tells the opted-in followers of a linked team or person, under their mutes and quiet hours', async () => {
    const storyId = await story([
      { type: 'team', id: TEAM },
      { type: 'competition', id: PREMIER_LEAGUE },
      { type: 'person', id: PERSON },
    ]);
    expect((await type(storyId, 'transfer')).statusCode).toBe(204);

    const rows = (await told(storyId, 'transfer_news')).rows;
    // Not 'default' (off by default), not 'comp' (a competition is not a team
    // or player), not 'other' (follows nothing linked), not 'muted'.
    expect(names(rows)).toEqual(['person', 'quiet', 'team', 'transfers']);
    expect(rows.every((r) => r.subject_type === 'story')).toBe(true);
    expect(rows.find((r) => r.user_id === members.get('quiet'))?.held).toBe(true);
    expect(rows.find((r) => r.user_id === members.get('team'))?.held).toBe(false);
    expect((await told(storyId, 'availability_news')).rows).toEqual([]);

    // The line is the type and the promoted original's newest headline; it opens the story.
    const inbox = await notificationsStore.inbox(members.get('team')!, 20);
    const line = inbox.find((n) => n.kind === 'transfer_news' && n.subject_id === storyId);
    expect(line?.headline).toBe(`Transfer: Striker signs ${RUN}`);
    expect(
      notificationLine({ kind: 'transfer_news', source: null, headline: line!.headline }),
    ).toBe(`Transfer: Striker signs ${RUN}`);
    expect(
      notificationPath('en', {
        subject_type: 'story',
        subject_id: storyId,
        subject_label: null,
        kind: 'transfer_news',
      }),
    ).toBe(`/en/news/story/${storyId}`);
  });

  it('tells injury and suspension as one availability alert, once per story', async () => {
    const storyId = await story([{ type: 'team', id: TEAM }]);
    expect((await type(storyId, 'injury')).statusCode).toBe(204);
    expect((await type(storyId, 'suspension')).statusCode).toBe(204);
    expect((await type(storyId, 'opinion')).statusCode).toBe(204);
    expect((await type(storyId, 'injury')).statusCode).toBe(204);
    const rows = (await told(storyId, 'availability_news')).rows;
    // 'transfers' switched on transfer news only.
    expect(names(rows)).toEqual(['quiet', 'team']);
    const inbox = await notificationsStore.inbox(members.get('team')!, 20);
    expect(
      inbox.find((n) => n.kind === 'availability_news' && n.subject_id === storyId)?.headline,
    ).toBe(`Availability: Striker signs ${RUN}`);
  });

  it('tells nobody for any other type, and nobody when the story links nothing followed', async () => {
    const opinion = await story([{ type: 'team', id: TEAM }]);
    expect((await type(opinion, 'opinion')).statusCode).toBe(204);
    const counted = await pool.query(`SELECT 1 FROM notification WHERE subject_id = $1`, [opinion]);
    expect(counted.rows).toEqual([]);

    const unlinked = await story([]);
    expect((await type(unlinked, 'transfer')).statusCode).toBe(204);
    expect((await told(unlinked, 'transfer_news')).rows).toEqual([]);
  });

  it('tells a story once, when a later fetch gives it the publisher type, and never again', async () => {
    const item = (categories: string[]) =>
      `<item><title>Fee agreed ${RUN}</title><link>https://${HOST}/p-${RUN}</link><guid>p-${RUN}</guid>${categories
        .map((c) => `<category>${c}</category>`)
        .join('')}</item>`;
    const fetch = async (categories: string[]) => {
      transport.body = `<?xml version="1.0"?><rss version="2.0"><channel><title>T</title><language>en</language>${item(categories)}</channel></rss>`;
      const src = (await pool.query(`SELECT * FROM news_source WHERE id = $1`, [source])).rows[0];
      expect((await ingestion.fetchSource(src)).partial).toBeNull();
    };

    await fetch([]);
    const { rows } = await pool.query<{ id: string; story_id: string }>(
      `SELECT id, story_id FROM article WHERE source_id = $1 AND external_id = $2`,
      [source, `p-${RUN}`],
    );
    const { id: articleId, story_id: storyId } = rows[0]!;
    await pool.query(
      `INSERT INTO article_entity (article_id, entity_type, entity_id) VALUES ($1, 'team', $2)
       ON CONFLICT DO NOTHING`,
      [articleId, TEAM],
    );
    expect((await told(storyId, 'transfer_news')).rows).toEqual([]);

    await fetch(['Transfers']);
    expect(names((await told(storyId, 'transfer_news')).rows)).toEqual([
      'quiet',
      'team',
      'transfers',
    ]);

    // Withdrawn, then given again: still once.
    await fetch([]);
    await fetch(['Transfers']);
    expect((await told(storyId, 'transfer_news')).rows).toHaveLength(3);
  });
});
