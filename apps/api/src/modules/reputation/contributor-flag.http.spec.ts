import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiError, ContributorFlag, ContributorFlagListResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { MODEL_CLIENT, ModelClient } from '../forecast/forecast.service';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  IdentityService,
} from '../identity/identity.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ContributorFlagService } from './contributor-flag.service';
import { ReputationModule } from './reputation.module';

/**
 * A contributor below the threshold for a sustained period (T-1031, D-137),
 * against the real schema: the daily check raises one flag per stretch from
 * the stored ratings, tells the administrator once, never pauses anybody;
 * the console lists the open flags; an approver dismisses one with a reason,
 * audited; a member back above the threshold, or paused by a person, closes
 * theirs.
 */
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('contributor flags', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let flags: ContributorFlagService;
  let notifications: NotificationsService;
  const ids = new Map<string, string>();
  const cookies = new Map<string, string>();
  let snapshots = 0;

  const name = (label: string) => `cf${label}${RUN}`;
  const as = (label: string) => ({ cookie: `fmip_session=${cookies.get(label) ?? ''}` });

  async function register(label: string): Promise<void> {
    const username = name(label);
    const response = await app.inject({
      method: 'POST',
      url: '/auth/register',
      payload: {
        username,
        display_name: `Member ${label}`,
        email: `${username}@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      },
    });
    expect(response.statusCode).toBe(201);
    cookies.set(label, cookieValue(response.headers['set-cookie']));
    const { rows } = await pool.query<{ id: string }>(
      `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
      [username],
    );
    ids.set(label, rows[0]?.id ?? '');
  }

  /** A rating as the reputation job would have stored it, `daysAgo` days ago. */
  async function rated(label: string, rating: number, daysAgo: number): Promise<void> {
    snapshots += 1;
    await pool.query(
      `INSERT INTO rating_snapshot
         (user_id, formula_version, settled_count, rating, components, provisional,
          established, inputs_hash, computed_at)
       VALUES ($1, 'performance-rating@1.0.0', 200, $2, '{}'::jsonb, false, true, $3,
               now() - make_interval(days => $4))`,
      [ids.get(label), rating, `cf-${RUN}-${String(snapshots)}`, daysAgo],
    );
  }

  async function granted(label: string, daysAgo: number): Promise<void> {
    await pool.query(
      `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at, created_at)
       VALUES ($1, $2, 'the flag suite', 'contributor-rules@1.0.0', now(),
               now() - make_interval(days => $3))`,
      [ids.get(label), ids.get('mod'), daysAgo],
    );
  }

  const mine = (list: ContributorFlagListResponse) =>
    list.flags.filter((flag) => [...ids.keys()].some((label) => flag.username === name(label)));
  const openFlags = async () =>
    mine(
      (
        await app.inject({ method: 'GET', url: '/admin/contributor-flags', headers: as('mod') })
      ).json() as ContributorFlagListResponse,
    );
  const flagOf = async (label: string) =>
    (await openFlags()).find((flag) => flag.username === name(label));
  const closedFor = (label: string) =>
    pool
      .query<{ closed_reason: string | null }>(
        `SELECT closed_reason FROM contributor_flag WHERE user_id = $1 ORDER BY raised_at`,
        [ids.get(label)],
      )
      .then(({ rows }) => rows.map((row) => row.closed_reason));
  const heard = async () =>
    (await notifications.inbox(ids.get('admin') ?? '', 50)).filter(
      (n) => n.kind === 'contributor_below_threshold',
    );

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, ReputationModule],
    })
      .overrideProvider(IDENTITY_OPTIONS)
      .useValue({
        ...DEFAULT_IDENTITY_OPTIONS,
        sessionSecret: 'test-secret-'.repeat(4),
        webBaseUrl: 'http://web.test',
        cookieSecure: false,
      })
      .overrideProvider(MODEL_CLIENT)
      .useValue(new ModelClient({ baseUrl: 'http://model.test' }))
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });
    flags = app.get(ContributorFlagService);
    notifications = app.get(NotificationsService);

    for (const label of ['mod', 'admin', 'member', 'slow', 'fresh', 'fine', 'dip', 'paused']) {
      await register(label);
    }
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason)
       VALUES ($1, 'moderator', $1, 'the flag suite')`,
      [ids.get('mod')],
    );
    // This suite's own administrator, answered in place of the role table
    // (the reason `contributor-eligible.http.spec.ts` gives).
    vi.spyOn(app.get(IdentityService), 'holdersOf').mockImplementation((role) =>
      Promise.resolve(role === 'admin' ? [ids.get('admin') ?? ''] : []),
    );

    for (const label of ['slow', 'fresh', 'fine', 'dip', 'paused']) await granted(label, 90);
    // Below for 40 days: flagged.
    await rated('slow', 82, 60);
    await rated('slow', 61, 40);
    // Below for 10 days: not yet.
    await rated('fresh', 80, 60);
    await rated('fresh', 60, 10);
    // Below, then back above: not below.
    await rated('fine', 60, 50);
    await rated('fine', 75, 5);
    // Below for 45 days, and later recovers.
    await rated('dip', 55, 45);
    // Below for 35 days, and later paused by a person.
    await rated('paused', 50, 35);
  });

  afterAll(async () => {
    const everyone = [...ids.values()];
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(`DELETE FROM contributor_flag WHERE user_id = ANY($1::uuid[])`, [
        everyone,
      ]);
      await client.query(
        `DELETE FROM contributor_grant_event WHERE grant_id IN
           (SELECT id FROM contributor_grant WHERE user_id = ANY($1::uuid[]))`,
        [everyone],
      );
      await client.query(`DELETE FROM contributor_grant WHERE user_id = ANY($1::uuid[])`, [
        everyone,
      ]);
      await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [everyone]);
      await client.query(`DELETE FROM user_role WHERE user_id = ANY($1::uuid[])`, [everyone]);
      await client.query(`DELETE FROM rating_snapshot WHERE user_id = ANY($1::uuid[])`, [everyone]);
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [everyone]);
    await pool.end();
    await app.close();
  });

  it('flags a contributor below the threshold for the period, and pauses nobody', async () => {
    await flags.check(new Date(), 30);
    const open = await openFlags();
    expect(open.map((flag) => flag.username).sort()).toEqual(
      [name('dip'), name('paused'), name('slow')].sort(),
    );
    expect(await flagOf('slow')).toMatchObject({
      rating_at_flag: 61,
      rating_now: 61,
      threshold: 70,
      period_days: 30,
      rules_version: 'contributor-flag@1.0.0',
      standing: 'active',
      closed: null,
    });
    const { rows } = await pool.query(
      `SELECT 1 FROM contributor_grant_event e JOIN contributor_grant g ON g.id = e.grant_id
        WHERE g.user_id = ANY($1::uuid[])`,
      [[...ids.values()]],
    );
    expect(rows).toEqual([]);
  });

  it('tells the administrator once per flag, naming the member', async () => {
    await flags.check(new Date(), 30);
    const told = await heard();
    const aboutSlow = told.filter((n) => n.subject_id === ids.get('slow'));
    expect(aboutSlow).toHaveLength(1);
    expect(aboutSlow[0]).toMatchObject({
      subject_type: 'member',
      subject_label: name('slow'),
      headline: `${name('slow')} has stayed below the contributor threshold and is flagged for review. Nothing was paused.`,
    });
    expect(await openFlags()).toHaveLength(3);
  });

  it('lists flags only to approvers', async () => {
    const refused = await app.inject({
      method: 'GET',
      url: '/admin/contributor-flags',
      headers: as('member'),
    });
    expect(refused.statusCode).toBe(403);
  });

  it('dismisses a flag only with a reason, audited, and does not raise it again', async () => {
    const flag = (await flagOf('slow')) as ContributorFlag;
    const url = `/admin/contributor-flags/${flag.id}/dismiss`;
    const blank = await app.inject({ method: 'POST', url, payload: {}, headers: as('mod') });
    expect(blank.statusCode).toBe(400);
    expect((blank.json() as ApiError).message).toMatch(/Say why/);

    const done = await app.inject({
      method: 'POST',
      url,
      payload: { reason: 'Injured and resting; the numbers will come back.' },
      headers: as('mod'),
    });
    expect(done.statusCode).toBe(200);
    expect((done.json() as ContributorFlag).closed).toMatchObject({
      reason: 'dismissed',
      by: name('mod'),
      note: 'Injured and resting; the numbers will come back.',
    });
    const again = await app.inject({
      method: 'POST',
      url,
      payload: { reason: 'twice' },
      headers: as('mod'),
    });
    expect(again.statusCode).toBe(404);

    const audit = await pool.query<{ action: string; previous: { state: string } }>(
      `SELECT action, previous FROM audit_log WHERE target_id = $1`,
      [ids.get('slow')],
    );
    expect(audit.rows).toEqual([
      expect.objectContaining({
        action: 'contributor.flag_dismiss',
        previous: expect.objectContaining({ state: 'open' }),
      }),
    ]);

    await flags.check(new Date(), 30);
    expect(await flagOf('slow')).toBeUndefined();
    expect(await closedFor('slow')).toEqual(['dismissed']);
  });

  it('closes a flag when the member is back above the threshold', async () => {
    await rated('dip', 74, 0);
    await flags.check(new Date(), 30);
    expect(await flagOf('dip')).toBeUndefined();
    expect(await closedFor('dip')).toEqual(['recovered']);
  });

  it('closes a flag once a person paused the grant, through the existing act', async () => {
    const paused = await app.inject({
      method: 'POST',
      url: `/admin/contributors/${name('paused')}/pause`,
      payload: { reason: 'Below the threshold for a month; talk first.' },
      headers: as('mod'),
    });
    expect(paused.statusCode).toBe(200);
    await flags.check(new Date(), 30);
    expect(await closedFor('paused')).toEqual(['grant_not_live']);
  });

  it('never edits a flag once raised', async () => {
    await expect(
      pool.query(`UPDATE contributor_flag SET rating = 1 WHERE user_id = $1`, [ids.get('slow')]),
    ).rejects.toMatchObject({ code: 'PL007' });
  });
});
