import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { CommunityConsensusResponse, ConsensusListResponse } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { ConsensusModule } from './consensus.module';

/**
 * Community consensus over HTTP (T-134, blueprint 6.6).
 *
 * The arithmetic is proved in `consensus.spec.ts`. What is proved here is what
 * only a database can answer: which version of a member's prediction counts,
 * which ratings weight it, and when the honest response is to publish nothing.
 */

const DATABASE_URL = process.env.DATABASE_URL;
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

const COMPETITION = randomUUID();
const SEASON = randomUUID();
/** Six predictors, two of them established raters. */
const FULL = randomUUID();
/** Two predictors: below the floor. */
const THIN = randomUUID();
/** Five predictors, not one established rating between them. */
const UNRATED = randomUUID();

const MEMBERS = Array.from({ length: 8 }, () => randomUUID());
const [M1, M2, M3, M4, M5, M6, M7] = MEMBERS as [
  string,
  string,
  string,
  string,
  string,
  string,
  string,
  string,
];

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'community consensus over HTTP',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;

    async function consensus(fixtureId: string): Promise<CommunityConsensusResponse> {
      const response = await app.inject({ method: 'GET', url: `/fixtures/${fixtureId}/consensus` });
      expect(response.statusCode).toBe(200);
      return response.json() as CommunityConsensusResponse;
    }

    /** One member's prediction, as a list of versions oldest first. */
    async function predict(
      userId: string,
      fixtureId: string,
      outcomes: ('home' | 'draw' | 'away')[],
    ): Promise<void> {
      const prediction = randomUUID();
      await pool.query(
        `INSERT INTO user_prediction (id, user_id, fixture_id) VALUES ($1, $2, $3)`,
        [prediction, userId, fixtureId],
      );
      for (const [index, outcome] of outcomes.entries()) {
        await pool.query(
          `INSERT INTO prediction_version (prediction_id, version_number, outcome, confidence)
           VALUES ($1, $2, $3, 3)`,
          [prediction, index + 1, outcome],
        );
      }
    }

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });

      await pool.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender)
         VALUES ($1, $2, $3, 'league', 'domestic', 'men')`,
        [COMPETITION, ENGLAND, `Consensus League ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2025/26', DATE '2025-08-01', DATE '2026-05-31', false)`,
        [SEASON, COMPETITION],
      );
      for (const fixture of [FULL, THIN, UNRATED]) {
        await pool.query(
          `INSERT INTO fixture (id, season_id, kickoff_at, status)
           VALUES ($1, $2, TIMESTAMPTZ '2099-01-01T12:00:00Z', 'scheduled')`,
          [fixture, SEASON],
        );
      }

      for (const [index, id] of MEMBERS.entries()) {
        await pool.query(
          `INSERT INTO user_account
             (id, username, display_name, email, country_id, preferred_language, timezone,
              accepted_rules_at, email_verified_at)
           VALUES ($1, $2, $3, $4, $5, 'en', 'Europe/London', now(), now())`,
          [
            id,
            `cons${index}${RUN}`.toLowerCase().slice(0, 20),
            `Consensus Member ${index}`,
            `cons${index}${RUN}@example.test`.toLowerCase(),
            ENGLAND,
          ],
        );
      }

      // M1 and M2 are established; M3's rating is provisional, which must not
      // weight anything (D-052). Everybody else has never been rated.
      const rate = (userId: string, rating: number, established: boolean) =>
        pool.query(
          `INSERT INTO rating_snapshot
             (user_id, formula_version, settled_count, rating, components, provisional,
              established, inputs_hash)
           VALUES ($1, 'rating@1.0.0', 40, $2, '{}'::jsonb, $3, $4, $5)`,
          [userId, rating, !established, established, `hash-${userId}`],
        );
      await rate(M1, 80, true);
      await rate(M2, 40, true);
      await rate(M3, 90, false);

      // FULL: home 3, draw 1, away 2 — and M6 changed their mind, which must
      // count once, for what they last said.
      await predict(M1, FULL, ['home']);
      await predict(M2, FULL, ['home']);
      await predict(M3, FULL, ['draw']);
      await predict(M4, FULL, ['away']);
      await predict(M5, FULL, ['away']);
      await predict(M6, FULL, ['away', 'home']);

      await predict(M4, THIN, ['home']);
      await predict(M5, THIN, ['home']);

      await predict(M3, UNRATED, ['draw']);
      await predict(M4, UNRATED, ['home']);
      await predict(M5, UNRATED, ['home']);
      await predict(M6, UNRATED, ['away']);
      await predict(M7, UNRATED, ['draw']);

      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, ConsensusModule],
      }).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
    });

    afterAll(async () => {
      if (pool === undefined) return;
      // Prediction versions and rating snapshots are immutable by trigger
      // (rules 5 and 8), so even the cascade from deleting what owns them is
      // refused. Test data still has to go; the same device the forecast and
      // audit specs use.
      await pool.query(
        `ALTER TABLE prediction_version DISABLE TRIGGER prediction_version_immutable`,
      );
      await pool.query(`ALTER TABLE rating_snapshot DISABLE TRIGGER rating_snapshot_immutable`);
      try {
        await pool.query(`DELETE FROM user_prediction WHERE fixture_id = ANY($1)`, [
          [FULL, THIN, UNRATED],
        ]);
        await pool.query(`DELETE FROM rating_snapshot WHERE user_id = ANY($1)`, [MEMBERS]);
      } finally {
        await pool.query(
          `ALTER TABLE prediction_version ENABLE TRIGGER prediction_version_immutable`,
        );
        await pool.query(`ALTER TABLE rating_snapshot ENABLE TRIGGER rating_snapshot_immutable`);
      }
      await pool.query(`DELETE FROM user_account WHERE id = ANY($1)`, [MEMBERS]);
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1)`, [[FULL, THIN, UNRATED]]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
      await pool.end();
      await app.close();
    });

    it('counts each member once, for the version that stands', async () => {
      const payload = await consensus(FULL);

      expect(payload.coverage).toBe('available');
      expect(payload.data?.sample).toBe(6);
      // M6 submitted away and then home. Counting both would let any member
      // multiply their own voice by resubmitting.
      expect(payload.data?.crowd.counts).toEqual({ home: 3, draw: 1, away: 2 });
      expect(payload.data?.crowd.shares.home).toBe(0.5);
    });

    it('weights by established ratings only, and says how many carried it', async () => {
      const payload = await consensus(FULL);

      // M1 (80) and M2 (40) both picked home. M3's provisional 90 picked draw
      // and must not appear — a provisional rating is the system saying it does
      // not yet know, and weighting by it would present that as judgement.
      expect(payload.data?.weighted?.raters).toBe(2);
      expect(payload.data?.weighted?.shares).toEqual({ home: 1, draw: 0, away: 0 });
      // And the two distributions genuinely differ, which is why 6.6 asks for
      // both: the crowd is split, the rated members are not.
      expect(payload.data?.crowd.shares.home).not.toBe(payload.data?.weighted?.shares.home);
    });

    it('publishes no consensus below the floor, and says so rather than showing a percentage', async () => {
      const payload = await consensus(THIN);

      expect(payload.coverage).toBe('not_supplied');
      expect(payload.data).toBeNull();
      // It still reports when the last of those predictions arrived: nothing is
      // being hidden, there is just no consensus to publish yet.
      expect(payload.last_updated_at).not.toBeNull();
    });

    it('marks the module limited when nobody weighted has predicted', async () => {
      const payload = await consensus(UNRATED);

      expect(payload.coverage).toBe('limited');
      expect(payload.data?.sample).toBe(5);
      expect(payload.data?.crowd.counts).toEqual({ home: 2, draw: 2, away: 1 });
      // The second distribution is absent, not the first one copied.
      expect(payload.data?.weighted).toBeNull();
    });

    it('carries nothing from the other two prediction products', async () => {
      // Rule 6 at the payload, not just at the contract: blueprint 6.6 says the
      // website must not disguise community opinion as the statistical model,
      // and the first step would be a model field riding along here.
      const serialised = JSON.stringify(await consensus(FULL));

      expect(serialised).not.toMatch(/model_version|probabilit|founder|analysis/i);
    });

    it('answers for several fixtures in one request, in the order asked', async () => {
      // T-136. A page showing a day's matches asks once; asking once per match
      // is how a list endpoint ends up slower than what it replaced.
      const response = await app.inject({
        method: 'GET',
        url: `/consensus?fixtures=${UNRATED},${FULL},${THIN}`,
      });
      expect(response.statusCode).toBe(200);
      const body = response.json() as ConsensusListResponse;

      expect(body.fixtures.map((entry) => entry.fixture_id)).toEqual([UNRATED, FULL, THIN]);
      // And each carries its own honest answer, which differs per fixture.
      expect(body.fixtures.map((entry) => entry.consensus.coverage)).toEqual([
        'limited',
        'available',
        'not_supplied',
      ]);
    });

    it('gives the same answer in a list as it does one at a time', async () => {
      // Two code paths that can drift are two answers to one question. The
      // payload is built in one place; this is what says so.
      const [single, list] = await Promise.all([
        consensus(FULL),
        app
          .inject({ method: 'GET', url: `/consensus?fixtures=${FULL}` })
          .then((r) => (r.json() as ConsensusListResponse).fixtures[0]?.consensus),
      ]);

      expect(list?.coverage).toBe(single.coverage);
      expect(list?.data?.crowd).toEqual(single.data?.crowd);
      expect(list?.data?.weighted).toEqual(single.data?.weighted);
    });

    it('leaves out a fixture that does not exist rather than inventing a row for it', async () => {
      const missing = randomUUID();
      const response = await app.inject({
        method: 'GET',
        url: `/consensus?fixtures=${FULL},${missing}`,
      });
      const body = response.json() as ConsensusListResponse;

      // A list that answers for an unknown id teaches its caller that every id
      // is valid.
      expect(body.fixtures.map((entry) => entry.fixture_id)).toEqual([FULL]);
    });

    it('rejects a malformed id rather than quietly dropping it', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/consensus?fixtures=${FULL},not-a-uuid`,
      });

      // Skipping it would give a caller with one typo a shorter list and no
      // indication which match is missing.
      expect(response.statusCode).toBe(400);
    });

    it('is 404 for a fixture that does not exist', async () => {
      const response = await app.inject({
        method: 'GET',
        url: `/fixtures/${randomUUID()}/consensus`,
      });
      expect(response.statusCode).toBe(404);
    });
  },
);
