import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { HeldLocalesResponse, LocaleHoldListResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { LocaleHoldsModule } from './locale-holds.module';

/**
 * Holding back a language (T-1163, D-155): administrators only, each hold and
 * release with a reason and an audit row carrying what was there before; one
 * hold in force per language; English is never held; a guest reads which
 * languages are held, never why.
 *
 * `tr` is the language this spec holds and releases; it cleans up after
 * itself, so a suite running beside it sees no hold outlive the run.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const LOCALE = 'tr';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('locale holds', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const admin = `lh_${RUN}a`;
  const editor = `lh_${RUN}e`;
  const member = `lh_${RUN}m`;

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
      `SELECT id FROM user_account WHERE username = $1`,
      [username],
    );
    ids.set(username, rows[0]!.id);
  }

  const as = (username: string | null) =>
    username === null ? {} : { cookie: `fmip_session=${cookies.get(username) ?? ''}` };
  const post = (path: string, who: string | null, payload: unknown) =>
    app.inject({
      method: 'POST',
      url: `/admin/locales/${path}`,
      headers: as(who),
      payload: payload as Record<string, unknown>,
    });
  const held = async () =>
    (await app.inject({ method: 'GET', url: '/locale-holds' }))
      .json<HeldLocalesResponse>()
      .held.map((h) => h.locale);
  const audits = async () =>
    (
      await pool.query<{
        action: string;
        actor_id: string;
        reason: string;
        previous: Record<string, unknown>;
      }>(
        `SELECT action, actor_id, reason, previous FROM audit_log
          WHERE target_type = 'locale' AND target_id = $1 AND actor_id = $2
          ORDER BY created_at, id`,
        [LOCALE, ids.get(admin)],
      )
    ).rows;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, LocaleHoldsModule],
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
    await register(admin);
    await register(editor);
    await register(member);
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'admin', $1, 'the locale hold test'), ($2, 'editor', $2, 'the locale hold test')`,
      [ids.get(admin), ids.get(editor)],
    );
  });

  afterAll(async () => {
    const actors = [ids.get(admin)];
    await pool.query(`DELETE FROM locale_hold WHERE held_by = ANY($1::uuid[])`, [actors]);
    await withTriggersOff(pool, async (client) => {
      await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [actors]);
    });
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`lh_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('is for administrators only; an editor is not one', async () => {
    expect((await post(`${LOCALE}/hold`, null, { reason: 'x' })).statusCode).toBe(401);
    for (const who of [member, editor]) {
      const refused = await post(`${LOCALE}/hold`, who, { reason: 'x' });
      expect(refused.statusCode).toBe(403);
      expect(refused.json()).toEqual({
        error: 'forbidden',
        message: 'This needs the administrator role.',
      });
    }
    expect(
      (await app.inject({ method: 'GET', url: '/admin/locale-holds', headers: as(member) }))
        .statusCode,
    ).toBe(403);
  });

  it('insists on a reason, and never holds English or a language that is not ours', async () => {
    const unexplained = await post(`${LOCALE}/hold`, admin, { reason: ' ' });
    expect(unexplained.statusCode).toBe(400);
    expect(unexplained.json<{ message: string }>().message).toMatch(/why/i);
    for (const locale of ['en', 'x-rtl', 'fa', 'EN'])
      expect((await post(`${locale}/hold`, admin, { reason: 'x' })).statusCode).toBe(404);
    expect(await held()).not.toContain(LOCALE);
    expect(await audits()).toEqual([]);
  });

  it('holds a language, a guest reads it without the reason, and a second hold is refused', async () => {
    expect(
      (await post(`${LOCALE}/hold`, admin, { reason: 'The rules page is not reviewed.' }))
        .statusCode,
    ).toBe(204);
    const answer = (await app.inject({ method: 'GET', url: '/locale-holds' })).json();
    const mine = (answer as HeldLocalesResponse).held.find((h) => h.locale === LOCALE);
    expect(Object.keys(mine ?? {}).sort()).toEqual(['held_at', 'locale']);
    expect((await post(`${LOCALE}/hold`, admin, { reason: 'Again.' })).statusCode).toBe(400);
    expect(await audits()).toMatchObject([
      {
        action: 'locale.hold',
        actor_id: ids.get(admin),
        reason: 'The rules page is not reviewed.',
        previous: { held: false },
      },
    ]);
  });

  it('releases with a reason, recording the hold it ends, and may hold again', async () => {
    expect((await post(`${LOCALE}/release`, admin, {})).statusCode).toBe(400);
    expect(
      (await post(`${LOCALE}/release`, admin, { reason: 'Reviewed and fine.' })).statusCode,
    ).toBe(204);
    expect(await held()).not.toContain(LOCALE);
    expect((await post(`${LOCALE}/release`, admin, { reason: 'Again.' })).statusCode).toBe(404);
    expect((await audits())[1]).toMatchObject({
      action: 'locale.release',
      reason: 'Reviewed and fine.',
      previous: { held: true, reason: 'The rules page is not reviewed.' },
    });

    expect((await post(`${LOCALE}/hold`, admin, { reason: 'A new doubt.' })).statusCode).toBe(204);
    expect((await audits())[2]?.previous).toMatchObject({
      held: false,
      last_reason: 'The rules page is not reviewed.',
      last_release_reason: 'Reviewed and fine.',
    });
    const list = (
      await app.inject({ method: 'GET', url: '/admin/locale-holds', headers: as(admin) })
    ).json<LocaleHoldListResponse>();
    const ours = list.holds.filter((h) => h.locale === LOCALE && h.held_by === admin);
    expect(ours.map((h) => [h.reason, h.released_by])).toEqual([
      ['A new doubt.', null],
      ['The rules page is not reviewed.', admin],
    ]);
    expect((await post(`${LOCALE}/release`, admin, { reason: 'Cleaning up.' })).statusCode).toBe(
      204,
    );
  });
});
