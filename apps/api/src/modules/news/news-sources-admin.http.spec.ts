import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type {
  ApiError,
  NewsFeedPreview,
  NewsSourcesResponse,
  NewsSourceWriteResponse,
} from '@fmip/contracts';
import type { Transport, TransportResponse } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { feedUrlProblem } from './internal/feed-probe';
import { NEWS_TRANSPORT } from './internal/news-transport';
import { NewsModule } from './news.module';

/**
 * News sources in the console (T-1015): an administrator previews a feed
 * (robots.txt first, then one read, nothing written), adds it only when
 * that check passes, edits it (a new address is checked again) and drops it
 * with a reason; every write is an audit row with the reason and the
 * previous value (rule 10); a dropped source stays, dated, and is not read.
 * The feeds here are scripted: no real publisher is added (N-8).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const HOST = `https://sources-${RUN}.test`;

const RSS = (title: string) => `<?xml version="1.0"?>
<rss version="2.0"><channel><title>Scripted ${RUN}</title><language>en</language>
<item><title>${title}</title><link>${HOST}/a</link><guid>a-${RUN}</guid>
<description>A summary the publisher wrote.</description><pubDate>Mon, 28 Sep 2026 09:00:00 GMT</pubDate></item>
<item><title>No link here</title></item>
</channel></rss>`;

class ScriptedTransport implements Transport {
  readonly asked: string[] = [];
  constructor(readonly answers: Map<string, { status: number; body: string } | 'throw'>) {}
  async request(url: string): Promise<TransportResponse> {
    this.asked.push(url);
    const hit = this.answers.get(url) ?? { status: 404, body: 'not here' };
    if (hit === 'throw') throw new Error('connection reset');
    return { status: hit.status, body: hit.body, receivedAt: new Date().toISOString() };
  }
}

describe('feedUrlProblem (T-1015)', () => {
  it('takes a public http or https address and refuses the server’s own network', () => {
    expect(feedUrlProblem('https://publisher.example/feed.xml')).toBeNull();
    expect(feedUrlProblem('http://93.184.216.34/rss')).toBeNull();
    expect(feedUrlProblem('ftp://publisher.example/feed')).not.toBeNull();
    expect(feedUrlProblem('not a url')).not.toBeNull();
    for (const internal of [
      'http://localhost:3001/admin',
      'http://127.0.0.1/feed',
      'http://10.0.0.5/feed',
      'http://172.20.1.1/feed',
      'http://192.168.1.1/feed',
      'http://169.254.169.254/latest/meta-data',
      'http://[::1]/feed',
      'http://api.internal/feed',
      'https://user:pw@publisher.example/feed',
    ]) {
      expect(feedUrlProblem(internal), internal).not.toBeNull();
    }
  });
});

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('news sources (T-1015)', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let transport: ScriptedTransport;
  const cookies = new Map<string, string>();
  const admin = `ns_${RUN}a`;
  const editor = `ns_${RUN}e`;
  const added: string[] = [];

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
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    username: string | null,
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      url,
      headers: username === null ? {} : { cookie: `fmip_session=${cookies.get(username) ?? ''}` },
      ...(payload === undefined ? {} : { payload }),
    });

  const source = (feed: string, extra: Record<string, unknown> = {}) => ({
    name: `Scripted ${RUN}`,
    homepage_url: HOST,
    feed_url: feed,
    kind: 'rss',
    rights: 'headline',
    language: 'en',
    reason: 'The maintainer chose this publisher (a test).',
    ...extra,
  });

  beforeAll(async () => {
    transport = new ScriptedTransport(
      new Map<string, { status: number; body: string } | 'throw'>([
        [`${HOST}/robots.txt`, { status: 200, body: 'User-agent: *\nDisallow: /private/\n' }],
        [`${HOST}/feed.xml`, { status: 200, body: RSS(`Scripted headline ${RUN}`) }],
        [`${HOST}/other.xml`, { status: 200, body: RSS(`Other headline ${RUN}`) }],
        [`${HOST}/private/feed.xml`, { status: 200, body: RSS('never read') }],
        [`${HOST}/page.html`, { status: 200, body: '<html><body>hello</body></html>' }],
        [`https://unreachable-${RUN}.test/robots.txt`, 'throw'],
      ]),
    );
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
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });

    const adminId = await register(admin);
    const editorId = await register(editor);
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'admin', $1, 'the news sources test'), ($2, 'editor', $1, 'the news sources test')`,
      [adminId, editorId],
    );
  });

  afterAll(async () => {
    await withTriggersOff(pool, async (client) => {
      await client.query(
        `DELETE FROM audit_log WHERE target_type = 'news_source' AND target_id = ANY($1::text[])`,
        [added],
      );
    });
    await pool.query(`DELETE FROM news_source WHERE id = ANY($1::uuid[])`, [added]);
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`ns_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('is the administrators’ only', async () => {
    expect((await call('GET', '/admin/news-sources', null)).statusCode).toBe(401);
    expect((await call('GET', '/admin/news-sources', editor)).statusCode).toBe(403);
    expect((await call('GET', '/admin/news-sources', admin)).statusCode).toBe(200);
  });

  it('previews a feed after its robots.txt, and writes nothing', async () => {
    const before = await pool.query(`SELECT count(*)::int AS n FROM news_source`);
    const response = await call('POST', '/admin/news-sources/preview', admin, {
      feed_url: `${HOST}/feed.xml`,
    });
    expect(response.statusCode).toBe(200);
    const preview = response.json<NewsFeedPreview>();
    expect(preview.robots).toEqual({ url: `${HOST}/robots.txt`, verdict: 'allowed', status: 200 });
    expect(preview.feed).toMatchObject({ ok: true, kind: 'rss', items: 1, skipped: 1 });
    expect(preview.feed?.ok === true && preview.feed.sample[0]).toMatchObject({
      headline: `Scripted headline ${RUN}`,
      summary: 'A summary the publisher wrote.',
    });
    const after = await pool.query(`SELECT count(*)::int AS n FROM news_source`);
    expect(after.rows[0]).toEqual(before.rows[0]);
  });

  it('does not fetch a feed robots.txt disallows, or one whose robots.txt cannot be asked', async () => {
    transport.asked.length = 0;
    const disallowed = (
      await call('POST', '/admin/news-sources/preview', admin, {
        feed_url: `${HOST}/private/feed.xml`,
      })
    ).json<NewsFeedPreview>();
    expect(disallowed.robots.verdict).toBe('disallowed');
    expect(disallowed.feed).toBeNull();
    expect(transport.asked).toEqual([`${HOST}/robots.txt`]);
    const unreachable = (
      await call('POST', '/admin/news-sources/preview', admin, {
        feed_url: `https://unreachable-${RUN}.test/feed.xml`,
      })
    ).json<NewsFeedPreview>();
    expect(unreachable.robots.verdict).toBe('unreachable');
    expect(unreachable.feed).toBeNull();
    const refused = await call('POST', '/admin/news-sources/preview', admin, {
      feed_url: 'http://127.0.0.1:5432/',
    });
    expect(refused.statusCode).toBe(400);
  });

  it('refuses to add what the check refuses, naming the check', async () => {
    for (const [feed, words] of [
      [`${HOST}/private/feed.xml`, /disallows/],
      [`${HOST}/page.html`, /could not be read/],
      [`${HOST}/missing.xml`, /could not be read/],
    ] as const) {
      const response = await call('POST', '/admin/news-sources', admin, source(feed));
      expect(response.statusCode, feed).toBe(400);
      expect(response.json<ApiError>().fields?.feed_url).toMatch(words);
    }
    const wrongKind = await call(
      'POST',
      '/admin/news-sources',
      admin,
      source(`${HOST}/feed.xml`, { kind: 'atom' }),
    );
    expect(wrongKind.json<ApiError>().fields?.feed_url).toMatch(/is rss, not atom/);
    const fullText = await call(
      'POST',
      '/admin/news-sources',
      admin,
      source(`${HOST}/feed.xml`, { rights: 'full_text' }),
    );
    expect(fullText.json<ApiError>().fields?.rights).toMatch(/D-061/);
    const { rows } = await pool.query(`SELECT 1 FROM news_source WHERE homepage_url = $1`, [HOST]);
    expect(rows).toHaveLength(0);
  });

  it('adds, edits and drops, each audited with the reason and the previous value', async () => {
    const add = await call('POST', '/admin/news-sources', admin, source(`${HOST}/feed.xml`));
    expect(add.statusCode, add.body).toBe(201);
    const created = add.json<NewsSourceWriteResponse>();
    added.push(created.source.id);
    expect(created.source).toMatchObject({
      name: `Scripted ${RUN}`,
      feed_url: `${HOST}/feed.xml`,
      kind: 'rss',
      rights: 'headline',
      language: 'en',
      dropped_at: null,
      last_fetch: null,
    });
    expect(created.preview?.robots.verdict).toBe('allowed');
    const twice = await call('POST', '/admin/news-sources', admin, source(`${HOST}/feed.xml`));
    expect(twice.statusCode).toBe(409);

    const noReason = await call('PATCH', `/admin/news-sources/${created.source.id}`, admin, {
      rights: 'summary',
    });
    expect(noReason.statusCode).toBe(400);
    transport.asked.length = 0;
    const rights = await call('PATCH', `/admin/news-sources/${created.source.id}`, admin, {
      rights: 'summary',
      reason: 'Their terms allow the summary.',
    });
    expect(rights.statusCode, rights.body).toBe(200);
    expect(rights.json<NewsSourceWriteResponse>()).toMatchObject({
      source: { rights: 'summary' },
      preview: null,
    });
    // The address did not change, so nothing was fetched.
    expect(transport.asked).toEqual([]);
    const moved = await call('PATCH', `/admin/news-sources/${created.source.id}`, admin, {
      feed_url: `${HOST}/other.xml`,
      reason: 'The publisher moved the feed.',
    });
    expect(moved.statusCode, moved.body).toBe(200);
    expect(moved.json<NewsSourceWriteResponse>().preview?.feed).toMatchObject({ ok: true });
    const blocked = await call('PATCH', `/admin/news-sources/${created.source.id}`, admin, {
      feed_url: `${HOST}/private/feed.xml`,
      reason: 'Try a disallowed path.',
    });
    expect(blocked.statusCode).toBe(400);

    const dropWithout = await call(
      'POST',
      `/admin/news-sources/${created.source.id}/drop`,
      admin,
      {},
    );
    expect(dropWithout.statusCode).toBe(400);
    const drop = await call('POST', `/admin/news-sources/${created.source.id}/drop`, admin, {
      reason: 'The publisher asked to be dropped.',
    });
    expect(drop.statusCode, drop.body).toBe(201);
    expect(drop.json<NewsSourceWriteResponse>().source).toMatchObject({
      dropped_reason: 'The publisher asked to be dropped.',
    });
    expect(drop.json<NewsSourceWriteResponse>().source.dropped_at).not.toBeNull();
    expect(
      (await call('POST', `/admin/news-sources/${created.source.id}/drop`, admin, { reason: 'x' }))
        .statusCode,
    ).toBe(409);
    expect(
      (
        await call('PATCH', `/admin/news-sources/${created.source.id}`, admin, {
          name: 'Back again',
          reason: 'x',
        })
      ).statusCode,
    ).toBe(409);

    const { rows } = await pool.query<{
      action: string;
      reason: string;
      previous: Record<string, unknown> | null;
      next: Record<string, unknown>;
    }>(
      `SELECT action, reason, previous, next FROM audit_log
        WHERE target_type = 'news_source' AND target_id = $1 ORDER BY created_at, id`,
      [created.source.id],
    );
    expect(rows.map((r) => [r.action, r.reason])).toEqual([
      ['news_source.add', 'The maintainer chose this publisher (a test).'],
      ['news_source.edit', 'Their terms allow the summary.'],
      ['news_source.edit', 'The publisher moved the feed.'],
      ['news_source.drop', 'The publisher asked to be dropped.'],
    ]);
    expect(rows[0]!.previous).toBeNull();
    expect(rows[1]!.previous).toMatchObject({ rights: 'headline' });
    expect(rows[1]!.next).toMatchObject({ rights: 'summary' });
    expect(rows[2]!.previous).toMatchObject({ feed_url: `${HOST}/feed.xml` });
    expect(rows[3]!.previous).toMatchObject({ dropped_at: null });

    const list = (await call('GET', '/admin/news-sources', admin)).json<NewsSourcesResponse>();
    const ours = list.sources.find((s) => s.id === created.source.id);
    expect(ours?.dropped_reason).toBe('The publisher asked to be dropped.');
  });
});
