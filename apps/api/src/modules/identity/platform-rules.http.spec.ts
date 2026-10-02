import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { ProfileModule } from '../profile/profile.module';
import { IdentityModule } from './identity.module';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from './identity.service';
import { CaptureMailer, MAILER } from './internal/mailer';

// The platform-rules version (T-931, D-113) against the real schema: the
// version in force, the backfill's default, and acceptance are all decided
// by the database. Skipped, visibly, without DATABASE_URL.
const DATABASE_URL = process.env.DATABASE_URL;

// Seeded England (packages/db/seed/001_catalog.sql).
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

const FIRST = 'platform-rules@1.0.0';
const NEXT = 'platform-rules@1.1.0';
const NEXT_BODY = 'Changes. A test version: the rules as 1.0.0, with this sentence added.';

const options: IdentityOptions = {
  ...DEFAULT_IDENTITY_OPTIONS,
  sessionSecret: 'test-secret-'.repeat(4),
  webBaseUrl: 'http://web.test',
  cookieSecure: false,
};

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^fmip_session=([^;]*)/.exec(header ?? '');
  return match?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('platform rules version', () => {
  let app: NestFastifyApplication;
  let pool: Pool;

  const registration = (name: string) => ({
    username: `pr_${RUN}_${name}`,
    display_name: 'Rules Reader',
    email: `pr_${RUN}_${name}@example.test`,
    password: 'correct horse battery staple',
    country_id: ENGLAND,
    preferred_language: 'en',
    timezone: 'Europe/London',
    accept_rules: true,
  });

  const request = (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    cookie?: string,
    payload?: unknown,
  ) =>
    app.inject({
      method,
      url,
      ...(payload === undefined ? {} : { payload: payload as Record<string, unknown> }),
      headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
    });

  /**
   * Take the test version away again. Any account another spec registered
   * while it was in force is put back on 1.0.0, which is what it would have
   * accepted without this spec: its acceptance is moved to 1.0.0 rather than
   * deleted, so it still has one.
   *
   * Suites run in parallel against the same database (T-1347), so this is one
   * transaction that first locks the version row: a registration or an
   * acceptance holds a key-share lock on it until it commits, so the lock
   * waits for those already writing and holds off new ones, and the rows
   * moved below are all there are when the version is deleted.
   */
  async function unpublish(): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT 1 FROM platform_rules_version WHERE version = $1 FOR UPDATE`, [
        NEXT,
      ]);
      await client.query(
        `UPDATE platform_rules_acceptance a SET version = $2
          WHERE a.version = $1
            AND NOT EXISTS (SELECT 1 FROM platform_rules_acceptance f
                             WHERE f.user_id = a.user_id AND f.version = $2)`,
        [NEXT, FIRST],
      );
      await client.query(`DELETE FROM platform_rules_acceptance WHERE version = $1`, [NEXT]);
      await client.query(
        `UPDATE user_account SET accepted_rules_version = $2 WHERE accepted_rules_version = $1`,
        [NEXT, FIRST],
      );
      await client.query(`DELETE FROM platform_rules_version WHERE version = $1`, [NEXT]);
      await client.query('COMMIT');
    } catch (error: unknown) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, IdentityModule, ProfileModule],
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
    await unpublish();
  });

  afterAll(async () => {
    await unpublish();
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`pr_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  let member = '';
  let memberName = '';

  it('registration stores the version in force beside accepted_rules_at', async () => {
    const body = registration('a');
    const response = await request('POST', '/auth/register', undefined, body);
    expect(response.statusCode).toBe(201);
    member = cookieValue(response.headers['set-cookie']);
    memberName = body.username;

    expect(response.json().rules).toMatchObject({
      current: FIRST,
      accepted: FIRST,
      pending: false,
    });

    const { rows } = await pool.query<{ version: string; at: Date; accepted_at: Date }>(
      `SELECT u.accepted_rules_version AS version, u.accepted_rules_at AS at, a.accepted_at
         FROM user_account u
         JOIN platform_rules_acceptance a ON a.user_id = u.id AND a.version = u.accepted_rules_version
        WHERE u.username = $1`,
      [body.username],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.version).toBe(FIRST);
    expect(rows[0]?.accepted_at.toISOString()).toBe(rows[0]?.at.toISOString());
  });

  it('an account written without naming a version is on 1.0.0, the only version that existed', async () => {
    const { rows } = await pool.query<{ accepted_rules_version: string }>(
      `INSERT INTO user_account
         (username, display_name, email, country_id, preferred_language, timezone, accepted_rules_at)
       VALUES ($1, 'Backfilled', $2, $3, 'en', 'UTC', now())
       RETURNING accepted_rules_version`,
      [`pr_${RUN}_old`, `pr_${RUN}_old@example.test`, ENGLAND],
    );
    expect(rows[0]?.accepted_rules_version).toBe(FIRST);
  });

  it('anybody reads the rules in force', async () => {
    const response = await request('GET', '/rules/platform');
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      version: FIRST,
      published_at: '2026-09-15T00:00:00.000Z',
    });
    expect(response.json().body).toContain('Changes. If these rules change');
  });

  it('a new version: the member is asked once, reads it first, and nothing they wrote is hidden', async () => {
    // Something the member wrote, before the new version exists.
    const wrote = await request('PATCH', '/me/profile', member, { bio: 'Written under 1.0.0.' });
    expect(wrote.statusCode).toBe(200);

    await pool.query(`INSERT INTO platform_rules_version (version, body) VALUES ($1, $2)`, [
      NEXT,
      NEXT_BODY,
    ]);

    // Asked: the newer version is pending, and 1.0.0 still applies to them.
    const asked = await request('GET', '/auth/me', member);
    expect(asked.json().rules).toMatchObject({ current: NEXT, accepted: FIRST, pending: true });

    // Reading is not accepting: the text is there to read, and they are still asked.
    const read = await request('GET', '/rules/platform', member);
    expect(read.json()).toMatchObject({ version: NEXT, body: NEXT_BODY });
    expect((await request('GET', '/auth/me', member)).json().rules.pending).toBe(true);

    // Meanwhile nothing they wrote is hidden, and they can still write.
    const seen = await request('GET', `/profiles/${memberName}`);
    expect(seen.statusCode).toBe(200);
    expect(seen.json().profile.bio).toBe('Written under 1.0.0.');
    const again = await request('PATCH', '/me/profile', member, { bio: 'Still writing.' });
    expect(again.statusCode).toBe(200);
    expect((await request('GET', `/profiles/${memberName}`)).json().profile.bio).toBe(
      'Still writing.',
    );

    // The version they accept has to be the one in force.
    const stale = await request('POST', '/auth/rules/accept', member, { version: FIRST });
    expect(stale.statusCode).toBe(409);

    const accepted = await request('POST', '/auth/rules/accept', member, { version: NEXT });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json()).toMatchObject({ current: NEXT, accepted: NEXT, pending: false });

    // Once: not asked again, and a repeat records nothing new.
    expect((await request('GET', '/auth/me', member)).json().rules.pending).toBe(false);
    const repeat = await request('POST', '/auth/rules/accept', member, { version: NEXT });
    expect(repeat.statusCode).toBe(200);
    expect(repeat.json().accepted_at).toBe(accepted.json().accepted_at);

    const { rows } = await pool.query<{ version: string }>(
      `SELECT a.version FROM platform_rules_acceptance a
         JOIN user_account u ON u.id = a.user_id
        WHERE u.username = $1 ORDER BY a.accepted_at, a.version`,
      [memberName],
    );
    expect(rows.map((r) => r.version)).toEqual([FIRST, NEXT]);

    // A registration now accepts the new version and is not asked.
    const later = await request('POST', '/auth/register', undefined, registration('b'));
    expect(later.statusCode).toBe(201);
    expect(later.json().rules).toMatchObject({ current: NEXT, accepted: NEXT, pending: false });
  });

  it('accepting needs a session and a version', async () => {
    expect(
      (await request('POST', '/auth/rules/accept', undefined, { version: NEXT })).statusCode,
    ).toBe(401);
    const bad = await request('POST', '/auth/rules/accept', member, { version: 'anything' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().fields).toHaveProperty('version');
  });
});
