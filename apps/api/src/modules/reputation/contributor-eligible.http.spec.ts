import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
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
import { ReputationModule } from './reputation.module';
import { ReputationService } from './reputation.service';

/**
 * "A member becoming eligible for contributor review, to administrators"
 * (blueprint 18.3, T-833, D-100), through `ReputationService.recompute` --
 * the path the settlement job takes -- against the real schema. Administrators
 * hear of the transition, once; a recompute that changes nothing is silent; a
 * member who drops below and qualifies again is announced again; a member
 * already holding a grant is not; and a member who is not an administrator
 * never hears of it.
 */
const DATABASE_URL = process.env.DATABASE_URL;
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 });

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'contributor eligibility notices',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    let reputation: ReputationService;
    let notifications: NotificationsService;
    const ids = new Map<string, string>();
    let snapshots = 0;

    async function account(label: string): Promise<string> {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO user_account
           (username, display_name, email, country_id, preferred_language, timezone,
            accepted_rules_at, email_verified_at)
         VALUES ($1, $2, $3, $4, 'en', 'Europe/London', now(), now())
         RETURNING id`,
        [`ce${label}${RUN}`, `Eligible ${label}`, `ce${label}${RUN}@example.test`, ENGLAND],
      );
      const id = rows[0]?.id ?? '';
      ids.set(label, id);
      return id;
    }
    /** A rating as the reputation job would have stored it. */
    async function rated(label: string, rating: number): Promise<void> {
      snapshots += 1;
      await pool.query(
        `INSERT INTO rating_snapshot
           (user_id, formula_version, settled_count, rating, components, provisional,
            established, inputs_hash, computed_at)
         VALUES ($1, 'performance-rating@1.0.0', 200, $2, '{}'::jsonb, false, true, $3,
                 now() + make_interval(secs => $4))`,
        [ids.get(label), rating, `ce-${RUN}-${String(snapshots)}`, snapshots],
      );
    }
    const inboxOf = async (label: string) =>
      (await notifications.inbox(ids.get(label) ?? '', 50)).filter(
        (n) => n.kind === 'contributor_eligible',
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
      pool = new Pool({ connectionString: DATABASE_URL });
      reputation = app.get(ReputationService);
      notifications = app.get(NotificationsService);

      const admin = await account('admin');
      await account('rising');
      await account('granted');
      await account('member');
      // The administrators are this suite's own, answered in place of the
      // role table: a real `admin` row would make every suite running in
      // parallel that alerts "every administrator" (the watchdog's) write to
      // an account this suite deletes when it ends.
      vi.spyOn(app.get(IdentityService), 'holdersOf').mockImplementation((role) =>
        Promise.resolve(role === 'admin' ? [admin] : []),
      );
      await pool.query(
        `INSERT INTO contributor_grant (user_id, granted_by, reason, rules_version, accepted_at)
         VALUES ($1, $2, 'the eligibility notice test', 'contributor-rules@1.0.0', now())`,
        [ids.get('granted'), admin],
      );
    });

    afterAll(async () => {
      const everyone = [...ids.values()];
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = 'replica'`);
        await client.query(
          `DELETE FROM contributor_grant_event WHERE grant_id IN
             (SELECT id FROM contributor_grant WHERE user_id = ANY($1::uuid[]))`,
          [everyone],
        );
        await client.query(`DELETE FROM contributor_grant WHERE user_id = ANY($1::uuid[])`, [
          everyone,
        ]);
        await client.query(`DELETE FROM audit_log WHERE actor_id = ANY($1::uuid[])`, [everyone]);
        await client.query(`DELETE FROM rating_snapshot WHERE user_id = ANY($1::uuid[])`, [
          everyone,
        ]);
      } finally {
        await client.query(`SET session_replication_role = 'origin'`);
        client.release();
      }
      await pool.query(`DELETE FROM user_account WHERE id = ANY($1::uuid[])`, [everyone]);
      await pool.end();
      await app.close();
    });

    it('is silent while a member does not qualify', async () => {
      await rated('rising', 60);
      await reputation.recompute(ids.get('rising') ?? '');
      expect(await inboxOf('admin')).toEqual([]);
    });

    it('tells the administrator on the transition, naming the member and opening the queue', async () => {
      await rated('rising', 88);
      await reputation.recompute(ids.get('rising') ?? '');
      const heard = await inboxOf('admin');
      expect(heard).toHaveLength(1);
      expect(heard[0]).toMatchObject({
        subject_type: 'member',
        subject_id: ids.get('rising'),
        subject_label: `cerising${RUN}`,
        headline: `cerising${RUN} now meets the contributor requirements and is waiting for review.`,
        source: null,
      });
      // A member is never offered it, and never sent it.
      expect(await inboxOf('member')).toEqual([]);
      expect(await inboxOf('rising')).toEqual([]);
    });

    it('a recompute that changes nothing is not a second notice', async () => {
      await reputation.recompute(ids.get('rising') ?? '');
      await reputation.recompute(ids.get('rising') ?? '');
      expect(await inboxOf('admin')).toHaveLength(1);
    });

    it('dropping below and qualifying again is announced again, once', async () => {
      await rated('rising', 65);
      await reputation.recompute(ids.get('rising') ?? '');
      expect(await inboxOf('admin')).toHaveLength(1);
      await rated('rising', 90);
      await reputation.recompute(ids.get('rising') ?? '');
      await reputation.recompute(ids.get('rising') ?? '');
      expect(await inboxOf('admin')).toHaveLength(2);
      const { rows } = await pool.query<{ qualifies: boolean; times_qualified: number }>(
        `SELECT qualifies, times_qualified FROM contributor_eligibility_state WHERE user_id = $1`,
        [ids.get('rising')],
      );
      expect(rows[0]).toEqual({ qualifies: true, times_qualified: 2 });
    });

    it('says nothing about a member who already holds a grant', async () => {
      await rated('granted', 92);
      await reputation.recompute(ids.get('granted') ?? '');
      const about = (await inboxOf('admin')).filter((n) => n.subject_id === ids.get('granted'));
      expect(about).toEqual([]);
    });
  },
);
