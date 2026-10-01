import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { StoryPage } from '@fmip/contracts';
import type { Transport, TransportResponse } from '@fmip/ingestion';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { type ImageDownload, NEWS_IMAGE_FETCH } from './internal/news-media';
import { NEWS_TRANSPORT } from './internal/news-transport';
import { NewsIngestionService } from './news-ingestion.service';
import { MEDIA_ROOT } from './news-images.service';
import { NewsModule } from './news.module';

/**
 * News photos end to end (T-1322, D-177), against the real schema with every
 * response scripted: a source whose licence covers photos gets its own
 * photo stored on our volume and served from our route with its credit and
 * licence; a photo the page credits to AFP, a page that cannot be read and a
 * file that is not an image are refused or failed with the reason; a source
 * without the right keeps no URL and no row, and the database refuses one
 * (PL022); the agency's URL never reaches a response; an editor's show and
 * hide take effect at once and are audited.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const SITE = `https://licensed-${RUN}.test`;
const MEDIA = `https://media.licensed-${RUN}.test`;
const PLAIN = `https://plain-${RUN}.test`;

/** A JPEG header with a frame of the given size: all `sniffImage` reads. */
function jpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([
    0xff,
    0xd8,
    0xff,
    0xe0,
    0x00,
    0x10,
    0x4a,
    0x46,
    0x49,
    0x46,
    0x00,
    1,
    1,
    0,
    0,
    1,
    0,
    1,
    0,
    0,
    0xff,
    0xc0,
    0x00,
    0x11,
    0x08,
    height >> 8,
    height & 0xff,
    width >> 8,
    width & 0xff,
    3,
    1,
    0x22,
    0,
    2,
    0x11,
    1,
    3,
    0x11,
    1,
    0xff,
    0xd9,
  ]);
}

const item = (site: string, id: string, image: string): string =>
  `<item><title>Story ${id} ${RUN}</title><link>${site}/news/${id}</link><guid>${id}-${RUN}</guid>
   <pubDate>Thu, 01 Oct 2026 08:00:00 GMT</pubDate>
   <enclosure url="${image}" length="1" type="image/jpeg" /></item>`;

const feed = (site: string, ids: string[]): string =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>Scripted</title><language>fa</language>${ids
    .map((id) => item(site, id, `${MEDIA}/d/4/${id}.jpg`))
    .join('')}</channel></rss>`;

const page = (id: string, caption: string): string =>
  `<html><body><figure class="item-img"><img src="${MEDIA}/d/3/${id}.jpg?ts=1" title="${caption}" alt="" /></figure></body></html>`;

class ScriptedTransport implements Transport {
  readonly asked: string[] = [];
  constructor(readonly answers: Map<string, { status: number; body: string }>) {}
  async request(url: string): Promise<TransportResponse> {
    this.asked.push(url);
    const hit = this.answers.get(url) ?? { status: 404, body: 'not here' };
    return { status: hit.status, body: hit.body, receivedAt: new Date().toISOString() };
  }
}

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('news photos', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let service: NewsIngestionService;
  let root: string;
  let licensed: string;
  let plain: string;
  const downloads: string[] = [];
  const files = new Map<string, ImageDownload>();
  const transport = new ScriptedTransport(new Map());
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

  const article = async (sourceId: string, id: string) =>
    (
      await pool.query<{ id: string; story_id: string }>(
        `SELECT id, story_id FROM article WHERE source_id = $1 AND external_id = $2`,
        [sourceId, `${id}-${RUN}`],
      )
    ).rows[0]!;

  const imageRow = async (articleId: string) =>
    (
      await pool.query<{
        state: string;
        reason: string;
        file_key: string | null;
        credit: string | null;
      }>(`SELECT state, reason, file_key, credit FROM article_image WHERE article_id = $1`, [
        articleId,
      ])
    ).rows[0] ?? null;

  const storyPage = async (storyId: string): Promise<StoryPage> => {
    const response = await app.inject({ method: 'GET', url: `/news/stories/${storyId}` });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(MEDIA);
    return response.json<StoryPage>();
  };

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'fmip-media-'));
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, NewsModule] })
      .overrideProvider(NEWS_TRANSPORT)
      .useValue(transport)
      .overrideProvider(NEWS_IMAGE_FETCH)
      .useValue(async (url: string): Promise<ImageDownload> => {
        downloads.push(url);
        return files.get(url) ?? { ok: false, reason: 'the image answered 404' };
      })
      .overrideProvider(MEDIA_ROOT)
      .useValue(root)
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
    service = moduleRef.get(NewsIngestionService);
    pool = new Pool({ connectionString: DATABASE_URL });

    await register(`im_${RUN}e`);
    await register(`im_${RUN}m`);
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'editor', $1, 'the news photo test')`,
      [ids.get(`im_${RUN}e`)],
    );

    const source = async (name: string, site: string): Promise<string> =>
      (
        await pool.query<{ id: string }>(
          `INSERT INTO news_source (name, homepage_url, feed_url, kind, rights, language)
           VALUES ($1, $2, $3, 'rss', 'summary', 'fa') RETURNING id`,
          [`${name} ${RUN}`, site, `${site}/rss`],
        )
      ).rows[0]!.id;
    licensed = await source('Licensed', SITE);
    plain = await source('Plain', PLAIN);
    await pool.query(
      `UPDATE news_source
          SET image_licence = 'cc-by-4.0', image_licence_url = 'https://creativecommons.org/licenses/by/4.0/',
              image_credit = 'Licensed News Agency', image_hosts = ARRAY[$2]
        WHERE id = $1`,
      [licensed, `licensed-${RUN}.test`],
    );

    transport.answers.set(`${SITE}/rss`, {
      status: 200,
      body: feed(SITE, ['own', 'afp', 'gone', 'html']),
    });
    transport.answers.set(`${SITE}/news/own`, { status: 200, body: page('own', 'A club photo') });
    transport.answers.set(`${SITE}/news/afp`, {
      status: 200,
      body: page('afp', 'A stadium. (Photo by AFP via Getty Images)'),
    });
    transport.answers.set(`${SITE}/news/html`, { status: 200, body: page('html', 'Training') });
    transport.answers.set(`${PLAIN}/rss`, { status: 200, body: feed(PLAIN, ['p1']) });
    files.set(`${MEDIA}/d/4/own.jpg`, {
      ok: true,
      bytes: jpeg(600, 400),
      contentType: 'image/jpeg',
    });
    files.set(`${MEDIA}/d/4/afp.jpg`, {
      ok: true,
      bytes: jpeg(800, 450),
      contentType: 'image/jpeg',
    });
    files.set(`${MEDIA}/d/4/html.jpg`, {
      ok: true,
      bytes: new TextEncoder().encode('<html>oops</html>'),
      contentType: 'image/jpeg',
    });
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(
        `DELETE FROM audit_log WHERE target_type = 'article'
            AND target_id IN (SELECT id::text FROM article WHERE source_id = ANY($1))`,
        [[licensed, plain]],
      );
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM news_source WHERE id = ANY($1)`, [[licensed, plain]]);
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`im_${RUN}%`]);
    await pool.end();
    await app.close();
    await rm(root, { recursive: true, force: true });
  });

  it("stores the agency's own photo and refuses or fails the rest, each with its reason", async () => {
    const licensedRun = await service.fetchSource({
      id: licensed,
      name: 'Licensed',
      homepage_url: SITE,
      feed_url: `${SITE}/rss`,
      kind: 'rss',
      rights: 'summary',
      language: 'fa',
    });
    expect(licensedRun.itemsWritten).toBe(4);

    const own = await imageRow((await article(licensed, 'own')).id);
    expect(own).toMatchObject({ state: 'stored', credit: 'Licensed News Agency' });
    expect(own?.file_key).toMatch(/^news\/[0-9a-f-]{36}\.jpg$/);
    expect(await readdir(join(root, 'news'))).toEqual([own!.file_key!.slice('news/'.length)]);

    expect(await imageRow((await article(licensed, 'afp')).id)).toMatchObject({
      state: 'refused',
      reason: 'the page credits afp, not the agency',
      file_key: null,
    });
    expect(await imageRow((await article(licensed, 'gone')).id)).toMatchObject({
      state: 'refused',
      reason: expect.stringContaining('could not be read'),
    });
    expect(await imageRow((await article(licensed, 'html')).id)).toMatchObject({
      state: 'failed',
      reason: 'not a JPEG, PNG or WebP file',
    });
    // A refused photo is never downloaded.
    expect(downloads).toEqual([`${MEDIA}/d/4/own.jpg`, `${MEDIA}/d/4/html.jpg`]);
  });

  it('decides each photo once: a second run fetches no page and no file', async () => {
    const asked = transport.asked.length;
    const downloaded = downloads.length;
    await service.fetchSource({
      id: licensed,
      name: 'Licensed',
      homepage_url: SITE,
      feed_url: `${SITE}/rss`,
      kind: 'rss',
      rights: 'summary',
      language: 'fa',
    });
    expect(transport.asked.slice(asked)).toEqual([`${SITE}/robots.txt`, `${SITE}/rss`]);
    expect(downloads.length).toBe(downloaded);
  });

  it('puts our own URL, the credit and the licence on the story, and serves the file', async () => {
    const own = await article(licensed, 'own');
    const story = await storyPage(own.story_id);
    const image = story.story.image;
    expect(image).toMatchObject({
      credit: 'Licensed News Agency',
      licence: 'cc-by-4.0',
      licence_url: 'https://creativecommons.org/licenses/by/4.0/',
      width: 600,
      height: 400,
    });
    expect(image?.url).toMatch(/^\/media\/news\/[0-9a-f-]{36}\.jpg$/);

    const served = await app.inject({ method: 'GET', url: image!.url });
    expect(served.statusCode).toBe(200);
    expect(served.headers['content-type']).toBe('image/jpeg');
    expect(served.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    expect(new Uint8Array(served.rawPayload)).toEqual(jpeg(600, 400));

    expect((await storyPage((await article(licensed, 'afp')).story_id)).story.image).toBeNull();
    const unknown = await app.inject({
      method: 'GET',
      url: '/media/news/00000000-0000-4000-8000-000000000000.jpg',
    });
    expect(unknown.statusCode).toBe(404);
    expect(
      (await app.inject({ method: 'GET', url: '/media/news/..%2F..%2Fetc.jpg' })).statusCode,
    ).toBe(404);
  });

  it('keeps no URL and no row for a source without the right, and the database refuses one (PL022)', async () => {
    await service.fetchSource({
      id: plain,
      name: 'Plain',
      homepage_url: PLAIN,
      feed_url: `${PLAIN}/rss`,
      kind: 'rss',
      rights: 'summary',
      language: 'fa',
    });
    const p1 = await article(plain, 'p1');
    expect(await imageRow(p1.id)).toBeNull();
    expect(transport.asked).not.toContain(`${PLAIN}/news/p1`);
    expect((await storyPage(p1.story_id)).story.image).toBeNull();

    await expect(
      pool.query(
        `INSERT INTO article_image (article_id, source_url, state, reason) VALUES ($1, 'x', 'refused', 'test')`,
        [p1.id],
      ),
    ).rejects.toMatchObject({ code: 'PL022' });
  });

  it("an editor's hide and show take effect at once and are audited", async () => {
    const own = await article(licensed, 'own');
    const afp = await article(licensed, 'afp');
    const before = (await storyPage(own.story_id)).story.image!.url;

    const member = await app.inject({
      method: 'POST',
      url: `/admin/articles/${own.id}/image`,
      headers: as(`im_${RUN}m`),
      payload: { action: 'hide', reason: 'not ours' },
    });
    expect(member.statusCode).toBe(403);
    const noReason = await app.inject({
      method: 'POST',
      url: `/admin/articles/${own.id}/image`,
      headers: as(`im_${RUN}e`),
      payload: { action: 'hide', reason: ' ' },
    });
    expect(noReason.statusCode).toBe(400);

    const hide = await app.inject({
      method: 'POST',
      url: `/admin/articles/${own.id}/image`,
      headers: as(`im_${RUN}e`),
      payload: { action: 'hide', reason: 'A Reuters photo after all' },
    });
    expect(hide.statusCode).toBe(204);
    expect((await storyPage(own.story_id)).story.image).toBeNull();
    expect((await app.inject({ method: 'GET', url: before })).statusCode).toBe(404);

    const show = await app.inject({
      method: 'POST',
      url: `/admin/articles/${afp.id}/image`,
      headers: as(`im_${RUN}e`),
      payload: { action: 'show', reason: 'Our own photographer; the caption was wrong' },
    });
    expect(show.statusCode).toBe(204);
    expect(await imageRow(afp.id)).toMatchObject({ state: 'stored' });
    expect((await storyPage(afp.story_id)).story.image).not.toBeNull();

    const plainArticle = await article(plain, 'p1');
    const refused = await app.inject({
      method: 'POST',
      url: `/admin/articles/${plainArticle.id}/image`,
      headers: as(`im_${RUN}e`),
      payload: { action: 'show', reason: 'try' },
    });
    expect(refused.statusCode).toBe(409);

    const audit = await pool.query<{
      action: string;
      reason: string;
      previous: unknown;
      next: unknown;
    }>(
      `SELECT action, reason, previous, next FROM audit_log
        WHERE target_type = 'article' AND target_id = ANY($1) ORDER BY created_at`,
      [[own.id, afp.id]],
    );
    expect(audit.rows).toEqual([
      {
        action: 'article_image.override',
        reason: 'A Reuters photo after all',
        previous: { editor_override: null, state: 'stored', reason: expect.any(String) },
        next: { editor_override: 'hide' },
      },
      {
        action: 'article_image.override',
        reason: 'Our own photographer; the caption was wrong',
        previous: {
          editor_override: null,
          state: 'stored',
          reason: 'the page credits afp, not the agency; shown by an editor',
        },
        next: { editor_override: 'show' },
      },
    ]);
  });
});
