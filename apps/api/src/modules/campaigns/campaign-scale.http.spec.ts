import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import {
  OUTBOUND_DELIVERY,
  type OutboundDelivery,
  type OutboundEmail,
  type OutboundPush,
} from '../delivery/delivery.port';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { NotificationsService, WEB_ORIGIN } from '../notifications/notifications.service';
import { CampaignsModule } from './campaigns.module';
import { CampaignsService } from './campaigns.service';

/**
 * A large campaign is carried in one send (T-837). Until then a send carried
 * one page -- a hundred -- and left the rest to the timer's hundred every
 * five minutes: eight hours for 10,000 members. Here every member is
 * reached, carried once by e-mail and once by push before `send()` returns,
 * and no notification is carried twice. The times are printed for
 * `docs/08-load-test.md`.
 *
 * **1,000 members in the suite, 10,000 on demand.** Ten pages already prove
 * the send drains past the first; the 10,000 run took four to seven minutes
 * and ~100,000 queries, which beside 180 other suites sharing one database
 * pushed their 5-second tests over. Since T-903 emission is set-based (two
 * statements per 500 members) and the run is 35 to 50 seconds. Run it with
 * `FMIP_CAMPAIGN_SCALE_MEMBERS=10000` (see `docs/08-load-test.md`).
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const MEMBERS = Number(process.env.FMIP_CAMPAIGN_SCALE_MEMBERS ?? '') || 1_000;
/**
 * The whole send, emission and carriage, in the test database: minutes, not
 * hours. 10,000 members measured at 4 to 7 minutes on a shared development
 * machine; the bound, scaled to the audience, leaves room for a slower one.
 */
const WITHIN_MS = Math.max(2, (15 * MEMBERS) / 10_000) * 60_000;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  `a campaign to ${MEMBERS.toLocaleString('en')} members`,
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    let campaigns: CampaignsService;
    let notifications: NotificationsService;
    const team = randomUUID();
    let adminId = '';
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
      campaigns = app.get(CampaignsService);
      notifications = app.get(NotificationsService);
      pool = new Pool({ connectionString: DATABASE_URL });

      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO user_account
           (username, display_name, email, country_id, preferred_language, timezone,
            accepted_rules_at, email_verified_at)
         VALUES ($1, 'Scale admin', $1 || '@example.test', $2, 'en', 'Europe/London', now(), now())
         RETURNING id`,
        [`cs_${RUN}_admin`, ENGLAND],
      );
      adminId = rows[0]!.id;
      // Ten thousand members following one team no one else follows: the audience.
      await pool.query(
        `WITH created AS (
           INSERT INTO user_account
             (username, display_name, email, country_id, preferred_language, timezone,
              accepted_rules_at, email_verified_at)
           SELECT $1 || n, 'Scale ' || n, $1 || n || '@example.test', $2, 'en', 'Europe/London',
                  now(), now()
             FROM generate_series(1, $3::int) AS n
           RETURNING id
         )
         INSERT INTO followed_entity (user_id, entity_type, entity_id)
         SELECT id, 'team', $4::uuid FROM created`,
        [`cs_${RUN}_`, ENGLAND, MEMBERS, team],
      );
    }, 120_000);

    afterAll(async () => {
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = 'replica'`);
        const mine = `SELECT id FROM campaign WHERE created_by = $1`;
        for (const table of ['campaign_dispatch_result', 'campaign_send', 'campaign_dispatch']) {
          await client.query(`DELETE FROM ${table} WHERE campaign_id IN (${mine})`, [adminId]);
        }
        await client.query(
          `DELETE FROM notification_delivery WHERE notification_id IN (
             SELECT id FROM notification WHERE subject_type = 'campaign' AND subject_id IN (
               SELECT id::text FROM campaign WHERE created_by = $1))`,
          [adminId],
        );
        await client.query(
          `DELETE FROM notification WHERE subject_type = 'campaign' AND subject_id IN (
             SELECT id::text FROM campaign WHERE created_by = $1)`,
          [adminId],
        );
        await client.query(`DELETE FROM campaign WHERE created_by = $1`, [adminId]);
        await client.query(`DELETE FROM audience WHERE created_by = $1`, [adminId]);
        await client.query(`DELETE FROM audit_log WHERE actor_id = $1`, [adminId]);
      } finally {
        await client.query(`SET session_replication_role = 'origin'`);
        client.release();
      }
      await pool.query(`DELETE FROM followed_entity WHERE entity_id = $1`, [team]);
      await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`cs\\_${RUN}\\_%`]);
      await pool.end();
      await app.close();
    }, 120_000);

    it(
      'reaches and carries every member once, in the one send',
      async () => {
        const audience = await campaigns.createAudience({
          name: `Scale ${RUN}`,
          filter: { follows: { type: 'team', id: team } },
          actorId: adminId,
          reason: 'the T-837 scale test',
        });
        expect(audience.size).toBe(MEMBERS);
        const campaign = await campaigns.createCampaign({
          audienceId: audience.id,
          title: `Scale ${RUN}`,
          body: 'Ten thousand at once.',
          path: '/scores',
          actorId: adminId,
          reason: 'the T-837 scale test',
        });
        if (campaign === 'no_audience') throw new Error('audience vanished');

        // Time the carriage apart from the emission.
        let carryMs = 0;
        const drain = notifications.drain.bind(notifications);
        const spy = vi.spyOn(notifications, 'drain').mockImplementation(async (...args) => {
          const started = performance.now();
          const report = await drain(...args);
          carryMs += performance.now() - started;
          return report;
        });

        const started = performance.now();
        const sent = await campaigns.send(campaign.id, adminId, 'the T-837 scale test');
        const totalMs = performance.now() - started;
        spy.mockRestore();

        expect(sent.outcome).toBe('sent');
        if (sent.outcome !== 'sent') return;
        expect(sent.dispatch.reached).toBe(MEMBERS);
        expect(sent.dispatch.failed).toBe(0);

        // Every notification of the campaign claimed, every member carried
        // once on each channel, nobody twice.
        const { rows } = await pool.query<{ written: number; carried: number }>(
          `SELECT count(*)::int AS written, count(d.notification_id)::int AS carried
             FROM notification n
             LEFT JOIN notification_delivery d ON d.notification_id = n.id
            WHERE n.subject_type = 'campaign' AND n.subject_id = $1`,
          [campaign.id],
        );
        expect(rows[0]).toEqual({ written: MEMBERS, carried: MEMBERS });
        const ours = mails.filter((m) => m.subject === `Scale ${RUN}`);
        expect(ours).toHaveLength(MEMBERS);
        expect(new Set(ours.map((m) => m.to)).size).toBe(MEMBERS);
        expect(pushes.filter((p) => p.title === `Scale ${RUN}`)).toHaveLength(MEMBERS);

        // A second drain finds nothing of theirs left.
        const again = await notifications.drain({ userIds: [adminId] });
        expect(again.stopped).toBe('drained');

        console.log(
          `T-837 campaign scale: members=${String(MEMBERS)} total_ms=${totalMs.toFixed(0)} ` +
            `emit_ms=${(totalMs - carryMs).toFixed(0)} carry_ms=${carryMs.toFixed(0)} ` +
            `carry_per_s=${(MEMBERS / (carryMs / 1000)).toFixed(0)}`,
        );
        expect(totalMs).toBeLessThan(WITHIN_MS);
      },
      WITHIN_MS + 60_000,
    );
  },
);
