import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { ApiError, FounderAnalysisResponse, FounderAnalysisVersion } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { DEFAULT_IDENTITY_OPTIONS, IDENTITY_OPTIONS } from '../identity/identity.service';
import { FounderModule } from './founder.module';

// The founder's analysis over HTTP (T-131): who may publish, what the database
// refuses, and the audit row every editorial act has to leave behind.
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const COMPETITION = randomUUID();
const SEASON = randomUUID();
const FIXTURE = randomUUID();
const STARTED = randomUUID();
const HOME = randomUUID();
const AWAY = randomUUID();

const BODY = {
  predicted_outcome: 'home',
  predicted_score: { home: 2, away: 1 },
  confidence: 4,
  reasoning:
    'They are the better side, at home, and the visitors have lost their last three away matches.',
  lineup_impact: 'Their first-choice centre-back is suspended.',
};

function cookieValue(setCookie: string | string[] | undefined): string {
  const header = Array.isArray(setCookie) ? setCookie[0] : setCookie;
  const match = /^fmip_session=([^;]*)/.exec(header ?? '');
  return match?.[1] ?? '';
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  "the founder's analysis over HTTP",
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    let founder = { id: '', cookie: '' };
    let member = { id: '', cookie: '' };

    const inject = (method: 'GET' | 'POST', url: string, cookie?: string, payload?: unknown) =>
      app.inject({
        method,
        url,
        payload: payload as Record<string, unknown> | undefined,
        headers: cookie === undefined ? {} : { cookie: `fmip_session=${cookie}` },
      });

    async function register(username: string, displayName: string) {
      const registered = await inject('POST', '/auth/register', undefined, {
        username,
        display_name: displayName,
        email: `${username}@example.test`,
        password: 'correct horse battery staple',
        country_id: ENGLAND,
        preferred_language: 'en',
        timezone: 'Europe/London',
        accept_rules: true,
      });
      const id = (registered.json() as { user: { id: string } }).user.id;
      return { id, cookie: cookieValue(registered.headers['set-cookie']) };
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, FounderModule],
      })
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

      founder = await register(`fo_${RUN}f`, 'The Founder');
      member = await register(`fo_${RUN}m`, 'A Member');
      await pool.query(
        `INSERT INTO user_role (user_id, role, granted_by, reason)
         VALUES ($1, 'founder', $1, 'founder analysis test')`,
        [founder.id],
      );

      await pool.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender)
         VALUES ($1, $2, $3, 'league', 'domestic', 'men')`,
        [COMPETITION, ENGLAND, `Founder League ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2025/26', DATE '2025-08-01', DATE '2026-05-31', false)`,
        [SEASON, COMPETITION],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender)
         VALUES ($1, $2, 'club', 'men'), ($3, $4, 'club', 'men')`,
        [HOME, `Nu ${RUN}`, AWAY, `Xi ${RUN}`],
      );
      for (const [id, kickoff] of [
        [FIXTURE, '2099-01-01T12:00:00Z'],
        [STARTED, '2020-01-01T12:00:00Z'],
      ] as const) {
        await pool.query(
          `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'scheduled')`,
          [id, SEASON, kickoff],
        );
        await pool.query(
          `INSERT INTO fixture_participant (fixture_id, team_id, side)
           VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
          [id, HOME, AWAY],
        );
      }
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await pool.query(
        `ALTER TABLE founder_analysis_version DISABLE TRIGGER founder_analysis_version_immutable`,
      );
      await pool.query(`DELETE FROM founder_analysis WHERE author_id = $1`, [founder.id]);
      await pool.query(
        `ALTER TABLE founder_analysis_version ENABLE TRIGGER founder_analysis_version_immutable`,
      );
      await pool.query('ALTER TABLE audit_log DISABLE TRIGGER audit_log_immutable');
      await pool.query(`DELETE FROM audit_log WHERE actor_id = $1`, [founder.id]);
      await pool.query('ALTER TABLE audit_log ENABLE TRIGGER audit_log_immutable');
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [[FIXTURE, STARTED]]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[HOME, AWAY]]);
      await pool.query(`DELETE FROM user_account WHERE username LIKE $1`, [`fo_${RUN}%`]);
      await pool.end();
      await app.close();
    });

    it('says there is no analysis without pretending the match is missing', async () => {
      const response = await inject('GET', `/fixtures/${FIXTURE}/founder-analysis`);
      expect(response.statusCode).toBe(200);
      expect((response.json() as FounderAnalysisResponse).analysis).toBeNull();

      // A match nobody has heard of is a different answer. Most matches have no
      // analysis — the blueprint scopes it to important fixtures — and that is
      // not the same as the match not existing.
      const unknown = await inject(
        'GET',
        '/fixtures/00000000-0000-4000-8000-0000000009ff/founder-analysis',
      );
      expect(unknown.statusCode).toBe(404);
    });

    it('lets only the founder publish — not a member, not a guest', async () => {
      const guest = await inject('POST', `/fixtures/${FIXTURE}/founder-analysis`, undefined, BODY);
      expect(guest.statusCode).toBe(401);

      const asMember = await inject(
        'POST',
        `/fixtures/${FIXTURE}/founder-analysis`,
        member.cookie,
        BODY,
      );
      expect(asMember.statusCode).toBe(403);
      expect((asMember.json() as ApiError).message).toContain('founder role');
    });

    it('publishes, signs it, and records an update as a second version', async () => {
      const first = await inject(
        'POST',
        `/fixtures/${FIXTURE}/founder-analysis`,
        founder.cookie,
        BODY,
      );
      expect(first.statusCode).toBe(201);
      expect((first.json() as FounderAnalysisVersion).version_number).toBe(1);

      const second = await inject('POST', `/fixtures/${FIXTURE}/founder-analysis`, founder.cookie, {
        ...BODY,
        confidence: 2,
        reasoning:
          'Their main striker has been ruled out, which changes the shape of this considerably.',
      });
      expect(second.statusCode).toBe(201);
      expect((second.json() as FounderAnalysisVersion).version_number).toBe(2);

      const read = await inject('GET', `/fixtures/${FIXTURE}/founder-analysis`);
      const body = read.json() as FounderAnalysisResponse;
      // Newest first, the earlier one still readable: the record of what was
      // said when is the reason for versioning it at all.
      expect(body.analysis?.versions.map((v) => v.version_number)).toEqual([2, 1]);
      expect(body.analysis?.author.display_name).toBe('The Founder');
      expect(body.analysis?.versions[1]?.confidence).toBe(4);
    });

    it('writes an audit row for every editorial act, in the same transaction', async () => {
      const { rows } = await pool.query<{ action: string; target_type: string }>(
        `SELECT action, target_type FROM audit_log WHERE actor_id = $1 ORDER BY created_at`,
        [founder.id],
      );
      expect(rows.map((r) => r.action)).toEqual(['founder.publish', 'founder.update']);
      expect(rows.every((r) => r.target_type === 'founder_analysis')).toBe(true);
    });

    it('refuses to publish once the match has kicked off', async () => {
      const late = await inject(
        'POST',
        `/fixtures/${STARTED}/founder-analysis`,
        founder.cookie,
        BODY,
      );
      // A conflict, not a validation error: the request was well formed and
      // arrived late. The database refused it, by its own clock.
      expect(late.statusCode).toBe(409);
      expect((late.json() as ApiError).message).toContain('kicked off');
    });

    it('names every invalid field at once', async () => {
      const bad = await inject('POST', `/fixtures/${FIXTURE}/founder-analysis`, founder.cookie, {
        predicted_outcome: 'perhaps',
        confidence: 9,
        reasoning: 'no',
      });
      expect(bad.statusCode).toBe(400);
      expect(Object.keys((bad.json() as ApiError).fields ?? {}).sort()).toEqual([
        'confidence',
        'predicted_outcome',
        'reasoning',
      ]);
    });
  },
);
