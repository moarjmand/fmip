import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { GroupPredictionComparisonResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { GroupsModule } from '../groups/groups.module';
import { IdentityModule } from '../identity/identity.module';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  type IdentityOptions,
} from '../identity/identity.service';
import { CaptureMailer, MAILER } from '../identity/internal/mailer';
import { PredictionsModule } from './predictions.module';

/**
 * Prediction comparison inside a group (T-246), against the real schema.
 *
 * **"Who called a fixture which way, in one place; never a second
 * settlement."** The second clause is the one worth testing hardest: the
 * comparison must show the settlement that was *stored*, unchanged, even when
 * the stored answer is one this route could have computed differently. So one
 * case writes a settlement that disagrees with the obvious reading of the score
 * and expects the comparison to repeat it.
 *
 * The other half is that a group is not a reason to show what a member has said
 * not to show: `prediction_history_visibility` decides, exactly as it does on a
 * profile, and a member it hides is **counted** rather than quietly dropped.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';
const ESTEGHLAL = '00000000-0000-4000-8000-000000000605';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

const options: IdentityOptions = {
  ...DEFAULT_IDENTITY_OPTIONS,
  sessionSecret: 'test-secret-'.repeat(4),
  webBaseUrl: 'http://web.test',
  cookieSecure: false,
};

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  return /^fmip_session=([^;]*)/.exec(header ?? '')?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'prediction comparison inside a group',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;

    const ada = `pc_${RUN}a`;
    const bo = `pc_${RUN}b`;
    const cass = `pc_${RUN}c`;
    const quiet = `pc_${RUN}q`;
    const outsider = `pc_${RUN}o`;
    const cookies = new Map<string, string>();
    const ids = new Map<string, string>();
    let competition = '';
    let season = '';
    let fixture = '';
    let slug = '';

    const as = (who?: string) =>
      who === undefined ? {} : { cookie: `fmip_session=${cookies.get(who) ?? ''}` };
    const get = (url: string, who?: string) => app.inject({ method: 'GET', url, headers: as(who) });
    const post = (url: string, payload: unknown, who?: string) =>
      app.inject({
        method: 'POST',
        url,
        payload: payload as Record<string, unknown>,
        headers: as(who),
      });

    const register = async (username: string) => {
      const response = await post('/auth/register', {
        username,
        display_name: `Member ${username}`,
        email: `${username}@example.test`,
        password: 'a perfectly fine passphrase',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      });
      expect(response.statusCode).toBe(201);
      cookies.set(username, cookieValue(response.headers['set-cookie']));
      const { rows } = await pool.query<{ id: string }>(
        `UPDATE user_account SET email_verified_at = now() WHERE username = $1 RETURNING id`,
        [username],
      );
      ids.set(username, rows[0]?.id ?? '');
    };

    /** A prediction, written the way the product writes one. */
    const call = async (who: string, outcome: string, confidence: number) => {
      const response = await app.inject({
        method: 'PUT',
        url: `/fixtures/${fixture}/prediction`,
        payload: { outcome, confidence, reason_tags: ['form'] },
        headers: as(who),
      });
      expect(response.statusCode, `${who} could not predict`).toBe(200);
      return (response.json() as { prediction: { id: string } }).prediction.id;
    };

    const comparison = async (who: string) => {
      const response = await get(`/groups/${slug}/fixtures/${fixture}/predictions`, who);
      expect(response.statusCode).toBe(200);
      return (response.json() as GroupPredictionComparisonResponse).comparison;
    };

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, IdentityModule, PredictionsModule, GroupsModule],
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

      for (const username of [ada, bo, cass, quiet, outsider]) await register(username);

      const { rows: competitions } = await pool.query<{ id: string }>(
        `INSERT INTO competition (country_id, name, kind, scope, gender)
         VALUES ($1, $2, 'league', 'domestic', 'men') RETURNING id`,
        [ENGLAND, `Comparison League ${RUN}`],
      );
      competition = competitions[0]?.id ?? '';
      const { rows: seasons } = await pool.query<{ id: string }>(
        `INSERT INTO season (competition_id, label, start_date, end_date, is_current)
         VALUES ($1, '2025/26', DATE '2025-08-01', DATE '2026-05-31', false) RETURNING id`,
        [competition],
      );
      season = seasons[0]?.id ?? '';
      const { rows: fixtures } = await pool.query<{ id: string }>(
        `INSERT INTO fixture (season_id, kickoff_at, status)
         VALUES ($1, TIMESTAMPTZ '2099-03-01T15:00:00Z', 'scheduled') RETURNING id`,
        [season],
      );
      fixture = fixtures[0]?.id ?? '';
      for (const [side, team] of [
        ['home', LIVERPOOL],
        ['away', ESTEGHLAL],
      ] as const) {
        await pool.query(
          `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, $3)`,
          [fixture, team, side],
        );
      }

      slug = `pc-${RUN}`.toLowerCase();
      expect(
        (
          await post(
            '/groups',
            { slug, name: `Comparison Group ${RUN}`, visibility: 'public' },
            ada,
          )
        ).statusCode,
      ).toBe(201);
      for (const who of [bo, cass, quiet]) {
        expect((await post(`/groups/${slug}/members`, {}, who)).statusCode).toBe(204);
      }

      // Four members, three calls, and one of the three is hidden by its own
      // owner. Cass says nothing at all.
      await call(ada, 'home', 4);
      await call(bo, 'draw', 2);
      await call(quiet, 'away', 5);
      await pool.query(
        `INSERT INTO privacy_setting (user_id, prediction_history_visibility)
         VALUES ($1, 'private')
         ON CONFLICT (user_id) DO UPDATE SET prediction_history_visibility = 'private'`,
        [ids.get(quiet) ?? ''],
      );
    });

    afterAll(async () => {
      const everyone = [...ids.values()];
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = 'replica'`);
        await client.query(
          `DELETE FROM settlement WHERE prediction_id IN
             (SELECT id FROM user_prediction WHERE user_id = ANY($1::uuid[]))`,
          [everyone],
        );
        await client.query(`DELETE FROM settlement_run WHERE fixture_id = $1`, [fixture]);
        await client.query(
          `DELETE FROM prediction_version WHERE prediction_id IN
             (SELECT id FROM user_prediction WHERE user_id = ANY($1::uuid[]))`,
          [everyone],
        );
        await client.query(`DELETE FROM user_prediction WHERE user_id = ANY($1::uuid[])`, [
          everyone,
        ]);
        await client.query(
          `DELETE FROM conversation WHERE group_id IN
             (SELECT id FROM user_group WHERE created_by = ANY($1::uuid[]))`,
          [everyone],
        );
        await client.query(
          `DELETE FROM group_member WHERE user_id = ANY($1::uuid[])
              OR group_id IN (SELECT id FROM user_group WHERE created_by = ANY($1::uuid[]))`,
          [everyone],
        );
        await client.query(`DELETE FROM user_group WHERE created_by = ANY($1::uuid[])`, [everyone]);
        await client.query(`DELETE FROM privacy_setting WHERE user_id = ANY($1::uuid[])`, [
          everyone,
        ]);
        await client.query(`DELETE FROM rate_window WHERE user_id = ANY($1::uuid[])`, [everyone]);
      } finally {
        await client.query(`SET session_replication_role = 'origin'`);
        client.release();
      }
      await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`pc_${RUN}%`]);
      if (season !== '') await pool.query(`DELETE FROM fixture WHERE season_id = $1`, [season]);
      if (competition !== '') {
        await pool.query(`DELETE FROM season WHERE competition_id = $1`, [competition]);
        await pool.query(`DELETE FROM competition WHERE id = $1`, [competition]);
      }
      await pool.end();
      await app.close();
    });

    it('puts who called it which way in one place', async () => {
      const found = await comparison(ada);
      expect(found.fixture_id).toBe(fixture);
      expect(found.locked).toBe(false);
      // Ordered by confidence: Ada at 4 before Bo at 2.
      expect(found.calls.map((c) => [c.username, c.version.outcome])).toEqual([
        [ada, 'home'],
        [bo, 'draw'],
      ]);
      expect(found.calls[0]?.revisions).toBe(1);
    });

    it('counts the silent and the withheld rather than dropping them', async () => {
      // Four members. Two calls shown, one hidden by its owner, one who said
      // nothing — and a reader can tell those two apart, which is the whole
      // reason they are separate numbers (rule 3).
      const found = await comparison(ada);
      expect(found.silent).toBe(1);
      expect(found.withheld).toBe(1);
      expect(found.calls.map((c) => c.username)).not.toContain(quiet);
    });

    it('shows a member their own call even when they hide it from everyone else', async () => {
      const found = await comparison(quiet);
      expect(found.calls.map((c) => c.username)).toContain(quiet);
      expect(found.withheld).toBe(0);
    });

    it('says how many times a call was changed', async () => {
      await call(bo, 'away', 3);
      const found = await comparison(ada);
      const theirs = found.calls.find((c) => c.username === bo);
      // The version that stands is the newest, and the count says it is not the
      // first: a call revised three times is not the same evidence as one made
      // once and left alone.
      expect(theirs?.version.outcome).toBe('away');
      expect(theirs?.revisions).toBe(2);
    });

    it('repeats the settlement that was stored, and never recomputes one', async () => {
      const { rows: predictions } = await pool.query<{ id: string; version_id: string }>(
        `SELECT p.id, v.id AS version_id
           FROM user_prediction p
           JOIN LATERAL (
             SELECT id FROM prediction_version
              WHERE prediction_id = p.id ORDER BY version_number DESC LIMIT 1
           ) v ON true
          WHERE p.user_id = $1 AND p.fixture_id = $2`,
        [ids.get(ada) ?? '', fixture],
      );
      const mine = predictions[0];
      expect(mine).toBeDefined();

      const { rows: runs } = await pool.query<{ id: string }>(
        `INSERT INTO settlement_run (fixture_id) VALUES ($1) RETURNING id`,
        [fixture],
      );
      // Deliberately at odds with the obvious reading of 0-3: Ada called a home
      // win and this row says she was right. A comparison that scored the calls
      // itself would "correct" this, and that is the defect being guarded
      // against — the stored settlement is the product's answer (rule 8).
      await pool.query(
        `INSERT INTO settlement
           (run_id, prediction_id, version_id, fixture_id, status, actual_home, actual_away,
            outcome_correct, score_predicted, confidence)
         VALUES ($1, $2, $3, $4, 'settled', 0, 3, true, false, 4)`,
        [runs[0]?.id ?? '', mine?.id ?? '', mine?.version_id ?? '', fixture],
      );

      const found = await comparison(ada);
      const theirs = found.calls.find((c) => c.username === ada);
      expect(theirs?.settlement?.status).toBe('settled');
      expect(theirs?.settlement?.outcome_correct).toBe(true);
      expect(theirs?.settlement?.actual).toEqual({ home: 0, away: 3 });
      // And nobody else's call gained a settlement from somebody else's.
      expect(found.calls.find((c) => c.username === bo)?.settlement).toBeNull();
    });

    it('answers a fixture nobody in the group called, without inventing a row', async () => {
      const { rows } = await pool.query<{ id: string }>(
        `INSERT INTO fixture (season_id, kickoff_at, status)
         VALUES ($1, TIMESTAMPTZ '2099-05-01T15:00:00Z', 'scheduled') RETURNING id`,
        [season],
      );
      const response = await get(`/groups/${slug}/fixtures/${rows[0]?.id ?? ''}/predictions`, ada);
      expect(response.statusCode).toBe(200);
      const found = (response.json() as GroupPredictionComparisonResponse).comparison;
      expect(found.calls).toEqual([]);
      expect(found.silent).toBe(4);
      expect(found.withheld).toBe(0);
    });

    it('is 404 for a fixture that does not exist and for a group that does not', async () => {
      const noFixture = await get(
        `/groups/${slug}/fixtures/00000000-0000-4000-8000-0000000000ff/predictions`,
        ada,
      );
      expect(noFixture.statusCode).toBe(404);
      const noGroup = await get(`/groups/not-a-group-at-all/fixtures/${fixture}/predictions`, ada);
      expect(noGroup.statusCode).toBe(404);
    });

    it('lets a stranger read a public group and refuses them a discoverable one', async () => {
      // The same door the leaderboard uses: a board and a comparison are both
      // the membership with something beside it (D-060).
      expect(
        (await get(`/groups/${slug}/fixtures/${fixture}/predictions`, outsider)).statusCode,
      ).toBe(200);

      await pool.query(`DELETE FROM rate_window WHERE user_id = $1 AND action = 'group_create'`, [
        ids.get(ada) ?? '',
      ]);
      const shy = `pc-${RUN}-shy`.toLowerCase();
      expect(
        (await post('/groups', { slug: shy, name: `Shy ${RUN}`, visibility: 'discoverable' }, ada))
          .statusCode,
      ).toBe(201);
      const refused = await get(`/groups/${shy}/fixtures/${fixture}/predictions`, outsider);
      expect(refused.statusCode).toBe(403);
    });
  },
);
