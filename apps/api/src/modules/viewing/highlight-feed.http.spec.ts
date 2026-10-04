import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { HighlightsFeedHealth, MatchViewing } from '@fmip/contracts';
import type { Transport, TransportResponse } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { HIGHLIGHT_FEED_CONFIG, HighlightFeedService } from './highlight-feed.service';
import { HIGHLIGHTLY_FEED_SOURCE } from './internal/highlight-feed-store';
import { HIGHLIGHT_FEED_TRANSPORT } from './internal/highlight-feed-transport';
import { ViewingModule } from './viewing.module';

/**
 * The highlights feed against a real database (T-1366, D-184): a verified
 * clip is placed on our match through the mapping table and stored once with
 * its territory rule; a visitor in an allowed territory sees it, as a link
 * with its publisher, and one outside does not; a desk page for the same
 * match and territory wins; an editor's removal withdraws the clip and the
 * feed never brings it back; a team nobody mapped is queued for the operator.
 *
 * Everything here is this file's own (competition, season, teams, matches,
 * mappings), and the provider is a scripted transport: no network.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const EDITORIAL = '00000000-0000-4000-8000-000000000901';
// Numeric ids the feed would use, unique to this run.
const BASE = 700_000_000 + (Date.now() % 90_000_000);
const LEAGUE = String(BASE);
const HOME = String(BASE + 1);
const AWAY = String(BASE + 2);
const STRANGER = String(BASE + 3);

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

class ScriptedProvider implements Transport {
  readonly urls: string[] = [];
  constructor(private readonly answer: (url: string) => unknown) {}
  request(url: string): Promise<TransportResponse> {
    this.urls.push(url);
    return Promise.resolve({
      status: 200,
      body: this.answer(url),
      receivedAt: new Date().toISOString(),
    });
  }
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the highlights feed', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let feed: HighlightFeedService;
  let session = '';
  let editorId = '';
  const editor = `hf_${RUN}e`;
  const competition = randomUUID();
  const season = randomUUID();
  const teams = [randomUUID(), randomUUID()];
  const fixture = randomUUID();
  const kickoff = new Date(Date.now() - 5 * 60 * 60 * 1000);
  kickoff.setUTCMilliseconds(0);

  const provider = new ScriptedProvider((url) => {
    if (url.includes('/geo-restrictions/')) {
      return {
        state: 'Allowed countries restriction',
        allowedCountries: ['DE', 'FR'],
        blockedCountries: [],
        embeddable: true,
      };
    }
    // Another suite's mapped league (or one a crashed run left behind) hears nothing.
    if (!url.includes(`leagueId=${LEAGUE}&`)) {
      return { data: [], pagination: { totalCount: 0, offset: 0, limit: 40 } };
    }
    const match = (homeId: string, homeName: string) => ({
      id: 9001,
      date: kickoff.toISOString(),
      homeTeam: { id: Number(homeId), name: homeName },
      awayTeam: { id: Number(AWAY), name: `Away ${RUN}` },
      league: { id: Number(LEAGUE), name: 'Feed League', season: 2026 },
    });
    return {
      data: [
        {
          id: 41001,
          type: 'UNVERIFIED',
          title: 'Fan upload',
          url: 'https://www.youtube.com/watch?v=fan',
          channel: 'Somebody',
          category: 'match-highlights',
          match: match(HOME, `Home ${RUN}`),
        },
        {
          id: 41002,
          type: 'VERIFIED',
          title: 'Official highlights',
          url: 'https://www.youtube.com/watch?v=official',
          embedUrl: 'https://www.youtube.com/embed/official',
          channel: 'LaLiga',
          category: 'match-highlights',
          match: match(HOME, `Home ${RUN}`),
        },
        {
          id: 41003,
          type: 'VERIFIED',
          title: 'Another match',
          url: 'https://www.youtube.com/watch?v=other',
          channel: 'LaLiga',
          category: 'match-highlights',
          match: match(STRANGER, `Stranger ${RUN}`),
        },
      ],
      pagination: { totalCount: 3, offset: 0, limit: 40 },
    };
  });

  const viewing = async (territory: string): Promise<MatchViewing> => {
    const response = await app.inject({
      method: 'GET',
      url: `/fixtures/${fixture}/viewing?territory=${territory}`,
    });
    expect(response.statusCode).toBe(200);
    return response.json<MatchViewing>();
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [DatabaseModule, ViewingModule] })
      .overrideProvider(MAILER)
      .useValue(new CaptureMailer())
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .overrideProvider(HIGHLIGHT_FEED_CONFIG)
      .useValue({ state: 'configured', apiKey: 'test-key', dailyBudget: 50 })
      .overrideProvider(HIGHLIGHT_FEED_TRANSPORT)
      .useValue(provider)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    feed = app.get(HighlightFeedService);
    pool = new Pool({ connectionString: DATABASE_URL });

    const registered = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username: editor,
        display_name: `Editor ${editor}`,
        email: `${editor}@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    expect(registered.statusCode).toBe(201);
    session = cookieValue(registered.headers['set-cookie']);
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
      [editor],
    );
    editorId = rows[0]!.id;
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'editor', $1, 'the highlights feed test')`,
      [editorId],
    );
    await pool.query(
      `INSERT INTO competition (id, name, kind, scope, gender)
       VALUES ($1, $2, 'league', 'international', 'men')`,
      [competition, `Feed League ${RUN}`],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, '2026', '2026-01-01', '2026-12-31', true)`,
      [season, competition],
    );
    await pool.query(
      `INSERT INTO team (id, name, kind, gender) VALUES ($1, $3, 'club', 'men'), ($2, $4, 'club', 'men')`,
      [teams[0], teams[1], `Home ${RUN}`, `Away ${RUN}`],
    );
    await pool.query(
      `INSERT INTO fixture (id, season_id, round, kickoff_at, status)
       VALUES ($1, $2, 'Round 7', $3, 'finished')`,
      [fixture, season, kickoff],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [fixture, teams[0], teams[1]],
    );
    await pool.query(
      `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id) VALUES
         ('highlightly', 'competition', $1, $4),
         ('highlightly', 'team', $2, $5),
         ('highlightly', 'team', $3, $6)`,
      [LEAGUE, HOME, AWAY, competition, teams[0], teams[1]],
    );
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM audit_log WHERE actor_id = $1`, [editorId]);
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM fixture WHERE id = $1`, [fixture]);
    await pool.query(
      `DELETE FROM provider_mapping WHERE provider = 'highlightly' AND external_id = ANY($1::text[])`,
      [[LEAGUE, HOME, AWAY]],
    );
    await pool.query(
      `DELETE FROM unresolved_entity WHERE provider = 'highlightly' AND external_id = ANY($1::text[])`,
      [[HOME, AWAY, STRANGER]],
    );
    await pool.query(`DELETE FROM season WHERE id = $1`, [season]);
    await pool.query(`DELETE FROM competition WHERE id = $1`, [competition]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
    await pool.query(`DELETE FROM user_account WHERE username = $1`, [editor]);
    await pool.end();
    await app.close();
  });

  it('says it is on, and has not run yet', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/highlights' });
    expect(response.statusCode).toBe(200);
    expect(response.json<HighlightsFeedHealth>()).toMatchObject({
      feed: 'configured',
      daily_budget: 50,
      last_run: null,
    });
  });

  it('stores the verified clip once, with its rule, and queues the team nobody mapped', async () => {
    const run = await feed.run();
    expect(run).toMatchObject({ stored: 1, unmatched: { team_unmapped: 1 }, stopped: null });
    expect(provider.urls.some((u) => u.includes(`leagueId=${LEAGUE}`))).toBe(true);
    expect(provider.urls.some((u) => u.endsWith('/geo-restrictions/41002'))).toBe(true);

    const { rows } = await pool.query<{
      url: string;
      publisher: string;
      allowed_territories: string[];
      source_id: string;
    }>(
      `SELECT url, publisher, allowed_territories, source_id FROM highlight_feed WHERE fixture_id = $1`,
      [fixture],
    );
    expect(rows).toEqual([
      {
        url: 'https://www.youtube.com/watch?v=official',
        publisher: 'LaLiga',
        allowed_territories: ['DE', 'FR'],
        source_id: HIGHLIGHTLY_FEED_SOURCE,
      },
    ]);
    const queued = await pool.query<{ status: string; name: string }>(
      `SELECT status, payload->>'name' AS name FROM unresolved_entity
        WHERE provider = 'highlightly' AND entity_type = 'team' AND external_id = $1`,
      [STRANGER],
    );
    expect(queued.rows).toEqual([{ status: 'pending', name: `Stranger ${RUN}` }]);

    // Held: the league's day is not asked again, and nothing is written twice.
    const asked = provider.urls.length;
    const again = await feed.run();
    expect(again).toMatchObject({ stored: 0 });
    expect(provider.urls.slice(asked).some((u) => u.includes(`leagueId=${LEAGUE}`))).toBe(false);
    const count = await pool.query(`SELECT 1 FROM highlight_feed WHERE fixture_id = $1`, [fixture]);
    expect(count.rowCount).toBe(1);
  });

  it('offers the clip as a link with its publisher where it is allowed, and nowhere else', async () => {
    const allowed = await viewing('DE');
    expect(allowed.highlights.coverage).toBe('limited');
    expect(allowed.highlights.data).toEqual([
      expect.objectContaining({
        kind: 'official_page',
        url: 'https://www.youtube.com/watch?v=official',
        embed_url: null,
        thumbnail_url: null,
        territory: 'DE',
        publisher: 'LaLiga',
        source: { id: HIGHLIGHTLY_FEED_SOURCE, name: 'Highlightly', rights: 'link' },
      }),
    ]);
    const elsewhere = await viewing('IR');
    expect(elsewhere.highlights).toEqual({
      coverage: 'not_supplied',
      last_updated_at: null,
      data: null,
    });
  });

  it('lets a desk page for the same match and territory win', async () => {
    await pool.query(
      `INSERT INTO viewing_coverage (season_id, territory, module, state, source_id)
       VALUES ($1, 'FR', 'highlights', 'available', $2)`,
      [season, EDITORIAL],
    );
    // Declared but no desk page: the feed's clip, under the desk's declaration.
    expect((await viewing('FR')).highlights).toMatchObject({
      coverage: 'available',
      data: [{ publisher: 'LaLiga' }],
    });
    const set = await app.inject({
      method: 'PUT',
      url: `/admin/fixtures/${fixture}/highlight`,
      headers: { cookie: `fmip_session=${session}` },
      payload: { territory: 'FR', url: 'https://official.test/fr-highlights' },
    });
    expect(set.statusCode).toBe(204);
    const desk = await viewing('FR');
    expect(desk.highlights.data?.map((h) => [h.url, h.publisher, h.source.id])).toEqual([
      ['https://official.test/fr-highlights', null, EDITORIAL],
    ]);
    // Germany has no desk page: still the feed's.
    expect((await viewing('DE')).highlights.data?.[0]?.publisher).toBe('LaLiga');
  });

  it("withdraws the feed's clip on an editor's removal, audited, and never brings it back", async () => {
    const removed = await app.inject({
      method: 'POST',
      url: `/admin/fixtures/${fixture}/highlight/DE/remove`,
      headers: { cookie: `fmip_session=${session}` },
      payload: { reason: 'the wrong match' },
    });
    expect(removed.statusCode).toBe(204);
    expect((await viewing('DE')).highlights.coverage).toBe('not_supplied');
    const audit = await pool.query<{ action: string; reason: string }>(
      `SELECT action, reason FROM audit_log WHERE actor_id = $1 AND action = 'highlight.withdraw_feed'`,
      [editorId],
    );
    expect(audit.rows).toEqual([{ action: 'highlight.withdraw_feed', reason: 'the wrong match' }]);
    await feed.run();
    const { rows } = await pool.query<{ withdrawn_reason: string | null }>(
      `SELECT withdrawn_reason FROM highlight_feed WHERE fixture_id = $1`,
      [fixture],
    );
    expect(rows).toEqual([{ withdrawn_reason: 'the wrong match' }]);
    const nothingLeft = await app.inject({
      method: 'POST',
      url: `/admin/fixtures/${fixture}/highlight/DE/remove`,
      headers: { cookie: `fmip_session=${session}` },
      payload: { reason: 'again' },
    });
    expect(nothingLeft.statusCode).toBe(404);
  });

  it('refuses, in the schema, a feed clip under the desk or at an address that is not https', async () => {
    const other = randomUUID();
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, now(), 'finished')`,
      [other, season],
    );
    try {
      await expect(
        pool.query(
          `INSERT INTO highlight_feed (fixture_id, source_id, url) VALUES ($1, $2, 'https://x.test/v')`,
          [other, EDITORIAL],
        ),
      ).rejects.toSatisfy((e) => (e as { code?: string }).code === 'PL017');
      await expect(
        pool.query(
          `INSERT INTO highlight_feed (fixture_id, source_id, url) VALUES ($1, $2, 'http://x.test/v')`,
          [other, HIGHLIGHTLY_FEED_SOURCE],
        ),
      ).rejects.toSatisfy((e) => (e as { code?: string }).code === '23514');
      await expect(
        pool.query(
          `INSERT INTO highlight_feed (fixture_id, source_id, url, blocked_territories)
           VALUES ($1, $2, 'https://x.test/v', '{Iran}')`,
          [other, HIGHLIGHTLY_FEED_SOURCE],
        ),
      ).rejects.toSatisfy((e) => (e as { code?: string }).code === '23514');
    } finally {
      await pool.query(`DELETE FROM fixture WHERE id = $1`, [other]);
    }
  });
});
