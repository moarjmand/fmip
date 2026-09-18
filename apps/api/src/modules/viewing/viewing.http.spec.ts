import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type {
  BroadcasterResponse,
  BroadcastersResponse,
  MatchViewing,
  ViewingBatchResponse,
  ViewingCoverageResponse,
  ViewingOptionResponse,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { ViewingModule } from './viewing.module';

/**
 * Where a match can be watched (T-313, D-069), through the API: a guest with
 * no territory is asked, not guessed at; a territory nobody declared is
 * `not_supplied`, dated only when somebody said so; a territory the desk
 * covers turns an empty listing into a fact; only an editor declares, lists
 * and removes, every write is an audit row, and a highlight from the desk is
 * the official page because the desk grants a link and nothing more.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const EDITORIAL = '00000000-0000-4000-8000-000000000901';
// Territories the schema spec does not touch, so the two files can run side by side.
const IRAN = 'IR';
const GERMANY = 'DE';
const SPAIN = 'ES';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('viewing', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const fixture = randomUUID();
  const other = randomUUID();
  let broadcaster = '';
  let optionId = '';
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const editor = `vw_${RUN}e`;
  const member = `vw_${RUN}m`;

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

  const viewing = async (id: string, query = '', username?: string): Promise<MatchViewing> => {
    const response = await app.inject({
      method: 'GET',
      url: `/fixtures/${id}/viewing${query}`,
      headers: username === undefined ? {} : as(username),
    });
    expect(response.statusCode).toBe(200);
    return response.json<MatchViewing>();
  };

  const declare = (territory: string, module: string, state: string, note = `schedule ${RUN}`) =>
    app.inject({
      method: 'PUT',
      url: '/admin/viewing/coverage',
      headers: as(editor),
      payload: { season_id: PL_2025, territory, module, state, note },
    });

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
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });

    await register(editor);
    await register(member);
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'editor', $1, 'the viewing test')`,
      [ids.get(editor)],
    );
    const chosen = await app.inject({
      method: 'PUT',
      url: '/me/territory',
      headers: as(member),
      payload: { code: IRAN },
    });
    expect(chosen.statusCode).toBe(200);
    await pool.query(
      `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
       VALUES ($1, $3, $4, 'Matchday 31', now() + interval '2 days', 'scheduled'),
              ($2, $3, $4, 'Matchday 31', now() + interval '3 days', 'scheduled')`,
      [fixture, other, PL_2025, REGULAR_SEASON],
    );
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      // The audit log is immutable by design; a test's own rows go with the triggers off.
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [
        [ids.get(editor), ids.get(member)],
      ]);
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(
      `DELETE FROM viewing_coverage WHERE season_id = $1 AND territory = ANY($2::text[])`,
      [PL_2025, [IRAN, GERMANY, SPAIN]],
    );
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [[fixture, other]]);
    if (broadcaster !== '')
      await pool.query(`DELETE FROM broadcaster WHERE id = $1`, [broadcaster]);
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`vw_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('asks a guest for a territory rather than guessing, and takes one from the query', async () => {
    const guest = await viewing(fixture);
    expect(guest.territory).toEqual({ state: 'not_chosen' });
    expect(guest.options).toEqual({ coverage: 'not_supplied', last_updated_at: null, data: null });
    expect(guest.highlights).toEqual({
      coverage: 'not_supplied',
      last_updated_at: null,
      data: null,
    });

    const asked = await viewing(fixture, '?territory=ir');
    expect(asked.territory).toEqual({ state: 'chosen', territory: { code: 'IR', name: 'Iran' } });

    const nowhere = await app.inject({
      method: 'GET',
      url: `/fixtures/${fixture}/viewing?territory=ZZ`,
    });
    expect(nowhere.statusCode).toBe(400);
    const unknown = await app.inject({ method: 'GET', url: `/fixtures/${randomUUID()}/viewing` });
    expect(unknown.statusCode).toBe(404);
    const malformed = await app.inject({ method: 'GET', url: `/fixtures/not-a-match/viewing` });
    expect(malformed.statusCode).toBe(404);
  });

  it('answers not_supplied for a territory nobody has declared, and dates it once somebody has', async () => {
    const before = await viewing(fixture, '', member);
    expect(before.territory).toEqual({ state: 'chosen', territory: { code: 'IR', name: 'Iran' } });
    expect(before.options.coverage).toBe('not_supplied');
    expect(before.options.last_updated_at).toBeNull();

    // "We do not cover Germany" is a declaration too: dated, sourceless, still not_supplied.
    expect((await declare(GERMANY, 'viewing', 'not_supplied')).statusCode).toBe(204);
    const germany = await viewing(fixture, `?territory=${GERMANY}`, member);
    expect(germany.options.coverage).toBe('not_supplied');
    expect(germany.options.last_updated_at).not.toBeNull();
    expect(germany.options.data).toBeNull();
  });

  it('lets only an editor declare, and refuses a listing in a territory the desk has not covered', async () => {
    const payload = {
      season_id: PL_2025,
      territory: IRAN,
      module: 'viewing',
      state: 'available',
      note: 'x',
    };
    const guest = await app.inject({ method: 'PUT', url: '/admin/viewing/coverage', payload });
    expect(guest.statusCode).toBe(401);
    const notEditor = await app.inject({
      method: 'PUT',
      url: '/admin/viewing/coverage',
      headers: as(member),
      payload,
    });
    expect(notEditor.statusCode).toBe(403);
    expect((await declare(IRAN, 'viewing', 'available', '')).statusCode).toBe(400);
    expect((await declare(IRAN, 'viewing', 'delayed')).statusCode).toBe(400);
    expect((await declare('XX', 'viewing', 'available')).statusCode).toBe(400);
    const noSeason = await app.inject({
      method: 'PUT',
      url: '/admin/viewing/coverage',
      headers: as(editor),
      payload: { ...payload, season_id: randomUUID() },
    });
    expect(noSeason.statusCode).toBe(404);

    const tooSoon = await app.inject({
      method: 'POST',
      url: `/admin/fixtures/${fixture}/viewing-options`,
      headers: as(editor),
      payload: {
        territory: IRAN,
        broadcaster_id: randomUUID(),
        access: 'free',
        url: 'https://tv.test/x',
      },
    });
    expect(tooSoon.statusCode).toBe(400);
    expect(tooSoon.json<{ message: string }>().message).toContain('Declare');
  });

  it('turns an empty listing into a fact once the desk covers the territory, and lists what the desk enters', async () => {
    expect((await declare(IRAN, 'viewing', 'available')).statusCode).toBe(204);
    const declared = await app.inject({
      method: 'GET',
      url: `/admin/viewing/coverage?season=${PL_2025}`,
      headers: as(editor),
    });
    expect(declared.json<ViewingCoverageResponse>().coverage).toContainEqual(
      expect.objectContaining({
        territory: IRAN,
        module: 'viewing',
        state: 'available',
        source: { id: EDITORIAL, name: 'Editorial desk', rights: 'link' },
      }),
    );

    const nothingYet = await viewing(fixture, '', member);
    expect(nothingYet.options.coverage).toBe('available');
    expect(nothingYet.options.data).toEqual([]);
    expect(nothingYet.options.last_updated_at).not.toBeNull();
    expect(nothingYet.highlights.coverage).toBe('not_supplied');

    const created = await app.inject({
      method: 'POST',
      url: '/admin/viewing/broadcasters',
      headers: as(editor),
      payload: { name: `IRIB Varzesh ${RUN}`, homepage_url: 'https://varzesh.test', kind: 'tv' },
    });
    expect(created.statusCode).toBe(201);
    broadcaster = created.json<BroadcasterResponse>().broadcaster.id;
    const listed = await app.inject({
      method: 'GET',
      url: '/admin/viewing/broadcasters',
      headers: as(editor),
    });
    expect(listed.json<BroadcastersResponse>().broadcasters.map((b) => b.id)).toContain(
      broadcaster,
    );

    const entry = {
      territory: 'ir',
      broadcaster_id: broadcaster,
      access: 'free',
      url: 'https://varzesh.test/live',
    };
    const option = await app.inject({
      method: 'POST',
      url: `/admin/fixtures/${fixture}/viewing-options`,
      headers: as(editor),
      payload: entry,
    });
    expect(option.statusCode).toBe(201);
    const entered = option.json<ViewingOptionResponse>().option;
    optionId = entered.id;
    expect(entered.territory).toBe(IRAN);
    expect(entered.broadcaster.name).toBe(`IRIB Varzesh ${RUN}`);
    expect(entered.source.rights).toBe('link');

    const twice = await app.inject({
      method: 'POST',
      url: `/admin/fixtures/${fixture}/viewing-options`,
      headers: as(editor),
      payload: entry,
    });
    expect(twice.statusCode).toBe(400);
    const refused = await Promise.all(
      [
        { ...entry, broadcaster_id: randomUUID() },
        { ...entry, access: 'pirate' },
        { ...entry, url: 'ftp://x.test' },
      ].map((payload) =>
        app.inject({
          method: 'POST',
          url: `/admin/fixtures/${fixture}/viewing-options`,
          headers: as(editor),
          payload,
        }),
      ),
    );
    expect(refused.map((r) => r.statusCode)).toEqual([404, 400, 400]);

    const seen = await viewing(fixture, '', member);
    expect(seen.options.data?.map((o) => o.broadcaster.id)).toEqual([broadcaster]);
    // Iran's listing says nothing about Spain.
    const spain = await viewing(fixture, `?territory=${SPAIN}`, member);
    expect(spain.options.coverage).toBe('not_supplied');

    const audit = await pool.query<{ action: string; actor_id: string }>(
      `SELECT action, actor_id FROM audit_log WHERE target_type = 'fixture' AND target_id = $1`,
      [fixture],
    );
    expect(audit.rows).toEqual([{ action: 'viewing.list', actor_id: ids.get(editor) }]);
  });

  it('keeps a highlight to the official page, because the desk grants a link and nothing more', async () => {
    const page = { territory: IRAN, url: 'https://official.test/highlights' };
    const early = await app.inject({
      method: 'PUT',
      url: `/admin/fixtures/${fixture}/highlight`,
      headers: as(editor),
      payload: page,
    });
    expect(early.statusCode).toBe(400);
    expect((await declare(IRAN, 'highlights', 'available')).statusCode).toBe(204);
    const set = await app.inject({
      method: 'PUT',
      url: `/admin/fixtures/${fixture}/highlight`,
      headers: as(editor),
      payload: page,
    });
    expect(set.statusCode).toBe(204);
    const first = await viewing(fixture, '', member);
    expect(first.highlights.coverage).toBe('available');
    expect(first.highlights.data).toHaveLength(1);
    expect(first.highlights.data?.[0]).toMatchObject({
      kind: 'official_page',
      url: page.url,
      embed_url: null,
      thumbnail_url: null,
      source: { id: EDITORIAL, rights: 'link' },
    });
    // Replaced, not duplicated.
    const again = await app.inject({
      method: 'PUT',
      url: `/admin/fixtures/${fixture}/highlight`,
      headers: as(editor),
      payload: { ...page, url: 'https://official.test/highlights-2' },
    });
    expect(again.statusCode).toBe(204);
    const second = await viewing(fixture, '', member);
    expect(second.highlights.data?.map((h) => h.url)).toEqual([
      'https://official.test/highlights-2',
    ]);
    // The schema, not this file, is what keeps a player out from under the desk (PL017).
    await expect(
      pool.query(
        `INSERT INTO highlight (fixture_id, territory, source_id, kind, url, embed_url)
         VALUES ($1, $2, $3, 'embed', 'https://official.test/h', 'https://player.test/1')`,
        [other, IRAN, EDITORIAL],
      ),
    ).rejects.toSatisfy((e) => (e as { code?: string }).code === 'PL017');

    const noReason = await app.inject({
      method: 'POST',
      url: `/admin/fixtures/${fixture}/highlight/${IRAN}/remove`,
      headers: as(editor),
      payload: {},
    });
    expect(noReason.statusCode).toBe(400);
    const removed = await app.inject({
      method: 'POST',
      url: `/admin/fixtures/${fixture}/highlight/${IRAN}/remove`,
      headers: as(editor),
      payload: { reason: 'the page moved' },
    });
    expect(removed.statusCode).toBe(204);
    const after = await viewing(fixture, '', member);
    expect(after.highlights).toMatchObject({ coverage: 'available', data: [] });
  });

  it('removes a listing with a reason, and answers several matches at once in the order asked', async () => {
    const noReason = await app.inject({
      method: 'POST',
      url: `/admin/fixtures/${fixture}/viewing-options/${optionId}/remove`,
      headers: as(editor),
      payload: { reason: '   ' },
    });
    expect(noReason.statusCode).toBe(400);
    const removed = await app.inject({
      method: 'POST',
      url: `/admin/fixtures/${fixture}/viewing-options/${optionId}/remove`,
      headers: as(editor),
      payload: { reason: 'the channel dropped the match' },
    });
    expect(removed.statusCode).toBe(204);
    expect((await viewing(fixture, '', member)).options.data).toEqual([]);

    const batch = await app.inject({
      method: 'GET',
      url: `/viewing?fixture=${other},${randomUUID()}&fixture=${fixture}`,
      headers: as(member),
    });
    expect(batch.statusCode).toBe(200);
    const body = batch.json<ViewingBatchResponse>();
    expect(body.territory).toEqual({ state: 'chosen', territory: { code: 'IR', name: 'Iran' } });
    expect(body.fixtures.map((f) => f.fixture_id)).toEqual([other, fixture]);
    expect(body.fixtures[0]?.options).toMatchObject({ coverage: 'available', data: [] });

    const empty = await app.inject({ method: 'GET', url: '/viewing' });
    expect(empty.statusCode).toBe(400);
    const tooMany = await app.inject({
      method: 'GET',
      url: `/viewing?fixture=${Array.from({ length: 101 }, () => randomUUID()).join(',')}`,
    });
    expect(tooMany.statusCode).toBe(400);
  });
});
