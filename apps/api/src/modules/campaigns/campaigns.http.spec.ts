import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { Audience, Campaign, CampaignDispatch } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import {
  OUTBOUND_DELIVERY,
  type OutboundDelivery,
  type OutboundEmail,
  type OutboundPush,
} from '../delivery/delivery.port';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { WEB_ORIGIN } from '../notifications/notifications.service';
import { CampaignsModule } from './campaigns.module';

/**
 * Campaigns through the API (T-332, D-075): an audience is a saved filter
 * with a size; a campaign is sent once, to every active member the filter
 * reaches, through the inbox -- a member who turned the kind off is muted,
 * not reached around the side -- and the report says who it reached; a
 * second send is refused; what left the inbox leaves by e-mail and push
 * with the campaign's own words; and none of it is reachable without the
 * administrator role.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('campaigns', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  const cookies = new Map<string, string>();
  const ids = new Map<string, string>();
  const admin = `cp_${RUN}a`;
  const fan = `cp_${RUN}f`;
  const quiet = `cp_${RUN}q`;
  const other = `cp_${RUN}o`;
  const mails: OutboundEmail[] = [];
  const pushes: OutboundPush[] = [];
  const channels: OutboundDelivery = {
    email: {
      provider: 'capture',
      send: async (mail) => {
        mails.push(mail);
      },
    },
    push: {
      provider: 'capture',
      send: async (push) => {
        pushes.push(push);
      },
    },
  };

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
  const post = (username: string, url: string, payload: unknown) =>
    app.inject({ method: 'POST', url, headers: as(username), payload: payload as never });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, CampaignsModule],
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
      .overrideProvider(OUTBOUND_DELIVERY)
      .useValue(channels)
      .overrideProvider(WEB_ORIGIN)
      .useValue('http://web.test')
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });
    for (const name of [admin, fan, quiet, other]) await register(name);
    await pool.query(
      `INSERT INTO user_role (user_id, role, granted_by, reason) VALUES ($1, 'admin', $1, 'campaign spec')`,
      [ids.get(admin)],
    );
    // The fan and the quiet member follow Liverpool; the quiet one turned campaigns off.
    await pool.query(
      `INSERT INTO followed_entity (user_id, entity_type, entity_id) VALUES ($1, 'team', $3), ($2, 'team', $3)`,
      [ids.get(fan), ids.get(quiet), LIVERPOOL],
    );
    await pool.query(
      `INSERT INTO notification_preference (user_id, kind, in_product) VALUES ($1, 'campaign', false)`,
      [ids.get(quiet)],
    );
  });

  afterAll(async () => {
    const client = await pool.connect();
    try {
      await client.query(`SET session_replication_role = 'replica'`);
      await client.query(
        `DELETE FROM campaign_dispatch_result WHERE campaign_id IN (SELECT id FROM campaign WHERE created_by = $1)`,
        [ids.get(admin)],
      );
      await client.query(
        `DELETE FROM campaign_send WHERE campaign_id IN (SELECT id FROM campaign WHERE created_by = $1)`,
        [ids.get(admin)],
      );
      await client.query(
        `DELETE FROM campaign_dispatch WHERE campaign_id IN (SELECT id FROM campaign WHERE created_by = $1)`,
        [ids.get(admin)],
      );
      await client.query(`DELETE FROM campaign WHERE created_by = $1`, [ids.get(admin)]);
      await client.query(`DELETE FROM audience WHERE created_by = $1`, [ids.get(admin)]);
      await client.query(`DELETE FROM audit_log WHERE actor_id = $1`, [ids.get(admin)]);
    } finally {
      await client.query(`SET session_replication_role = 'origin'`);
      client.release();
    }
    await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`cp_${RUN}%`]);
    await pool.end();
    await app.close();
  });

  it('needs the administrator role for every campaign endpoint', async () => {
    const guest = await app.inject({ method: 'GET', url: '/admin/audiences' });
    expect(guest.statusCode).toBe(401);
    const member = await app.inject({ method: 'GET', url: '/admin/campaigns', headers: as(fan) });
    expect(member.statusCode).toBe(403);
    const write = await post(fan, '/admin/audiences', { name: 'x', filter: {}, reason: 'x' });
    expect(write.statusCode).toBe(403);
  });

  it('saves an audience as a filter with a size, refuses a word the vocabulary lacks, and audits it', async () => {
    const created = await post(admin, '/admin/audiences', {
      name: `Liverpool followers ${RUN}`,
      filter: { follows: { type: 'team', id: LIVERPOOL }, verified_only: true },
      reason: 'the people a Liverpool message is for',
    });
    expect(created.statusCode).toBe(201);
    const audience = created.json<Audience>();
    expect(audience).toMatchObject({
      name: `Liverpool followers ${RUN}`,
      filter: { follows: { type: 'team', id: LIVERPOOL }, verified_only: true },
      created_by: admin,
    });
    // At least the fan and the quiet member; other suites' Liverpool followers may be counted too.
    expect(audience.size).toBeGreaterThanOrEqual(2);
    ids.set('audience', audience.id);

    const odd = await post(admin, '/admin/audiences', {
      name: 'odd',
      filter: { spends_a_lot: true },
      reason: 'x',
    });
    expect(odd.statusCode).toBe(400);
    expect(odd.json<{ message: string }>().message).toMatch(/spends_a_lot/);

    const audit = await pool.query<{ action: string; reason: string }>(
      `SELECT action, reason FROM audit_log WHERE actor_id = $1 AND target_type = 'audience'`,
      [ids.get(admin)],
    );
    expect(audit.rows).toEqual([
      { action: 'audience.create', reason: 'the people a Liverpool message is for' },
    ]);
  });

  it('creates a campaign on an audience and refuses a path that is not in the app', async () => {
    const bad = await post(admin, '/admin/campaigns', {
      audience_id: ids.get('audience'),
      title: 'Derby day',
      body: 'Predict before kick-off.',
      path: 'https://elsewhere.example/',
      reason: 'x',
    });
    expect(bad.statusCode).toBe(400);
    const created = await post(admin, '/admin/campaigns', {
      audience_id: ids.get('audience'),
      title: `Derby day ${RUN}`,
      body: 'Predict before kick-off and see how the model sees it.',
      path: '/scores',
      reason: 'the derby is on Sunday',
    });
    expect(created.statusCode).toBe(201);
    const campaign = created.json<Campaign>();
    expect(campaign).toMatchObject({
      title: `Derby day ${RUN}`,
      path: '/scores',
      audience_id: ids.get('audience'),
      dispatch: null,
    });
    ids.set('campaign', campaign.id);
  });

  it('sends once: every reached member has one inbox row, a muted member is counted and not reached, and the second send is refused', async () => {
    const sent = await post(admin, `/admin/campaigns/${ids.get('campaign')}/send`, {
      reason: 'go',
    });
    expect(sent.statusCode).toBe(201);
    const dispatch = sent.json<CampaignDispatch>();
    expect(dispatch.started_by).toBe(admin);
    expect(dispatch.finished_at).not.toBeNull();
    expect(dispatch.reached).toBeGreaterThanOrEqual(1);
    expect(dispatch.muted).toBeGreaterThanOrEqual(1);

    const rows = await pool.query<{ user_id: string; outcome: string }>(
      `SELECT user_id, outcome FROM campaign_send WHERE campaign_id = $1 AND user_id = ANY($2::uuid[])`,
      [ids.get('campaign'), [ids.get(fan), ids.get(quiet), ids.get(other)]],
    );
    const byUser = new Map(rows.rows.map((r) => [r.user_id, r.outcome]));
    expect(byUser.get(ids.get(fan)!)).toBe('sent');
    expect(byUser.get(ids.get(quiet)!)).toBe('muted');
    // Not in the audience: never a row.
    expect(byUser.has(ids.get(other)!)).toBe(false);

    const inbox = await pool.query<{ kind: string; headline: string | null }>(
      `SELECT n.kind, c.title AS headline FROM notification n
         JOIN campaign c ON c.id = n.subject_id::uuid
        WHERE n.user_id = $1 AND n.kind = 'campaign'`,
      [ids.get(fan)],
    );
    expect(inbox.rows).toEqual([{ kind: 'campaign', headline: `Derby day ${RUN}` }]);
    expect(
      (
        await pool.query(`SELECT 1 FROM notification WHERE user_id = $1 AND kind = 'campaign'`, [
          ids.get(quiet),
        ])
      ).rowCount,
    ).toBe(0);

    // Carried out with the campaign's own words, to the fan only.
    const mail = mails.filter((m) => m.to === `${fan}@example.test`);
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ subject: `Derby day ${RUN}` });
    expect(mail[0]?.text).toContain('/en/scores');
    expect(pushes.filter((p) => p.userId === ids.get(fan))[0]).toMatchObject({
      title: `Derby day ${RUN}`,
      url: '/en/scores',
    });

    const again = await post(admin, `/admin/campaigns/${ids.get('campaign')}/send`, {
      reason: 'again',
    });
    expect(again.statusCode).toBe(409);
    const shown = await app.inject({
      method: 'GET',
      url: `/admin/campaigns/${ids.get('campaign')}`,
      headers: as(admin),
    });
    expect(shown.json<Campaign>().dispatch?.reached).toBe(dispatch.reached);
    const audit = await pool.query<{ action: string }>(
      `SELECT action FROM audit_log WHERE actor_id = $1 AND target_type = 'campaign' ORDER BY created_at`,
      [ids.get(admin)],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['campaign.create', 'campaign.send']);
  });
});
