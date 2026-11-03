import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { ConsoleModelReport } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { withTriggersOff } from '../../testing/cleanup';
import { CONSOLE_OPTIONS } from '../agents-console/agents-console.controller';
import { consoleTokenText } from '../agents-console/internal/console-rules';
import { PostgresConsoleStore } from '../agents-console/internal/console-store';
import { EvaluationService } from '../forecast/evaluation.service';
import { MODEL_CLIENT, ModelClient } from '../forecast/forecast.service';
import { PostgresEvaluationStore } from '../forecast/internal/evaluation-store';
import { PostgresForecastStore, type NewForecast } from '../forecast/internal/forecast-store';
import { hashPassword, hashToken, newToken } from '../identity/identity.service';
import { ConsoleModelModule } from './console-model.module';

/**
 * T-1729 against the real schema: `GET /console/model` refuses without a
 * console session, names the versions the model service runs, and computes
 * the published version's record, calibration, trend and competitions, and
 * the candidate's paired and new-division counts, from seeded evaluations.
 * The versions carry this run's tag and the matches are in 2032.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const SECRET = 'console-model-secret-'.repeat(3);

// Seeded Premier League 2024/25 and two of its clubs (packages/db/seed/001_catalog.sql).
const COMPETITION = '00000000-0000-4000-8000-000000000201';
const SEASON = '00000000-0000-4000-8000-000000000301';
const HOME = '00000000-0000-4000-8000-000000000602';
const AWAY = '00000000-0000-4000-8000-000000000601';
const PUBLISHED = `cm-${RUN}@0.6.0`;
const SHADOW = `cm-${RUN}@0.7.0`;

// A Sunday and the Monday after it: two ISO weeks.
const SUNDAY = '2032-03-07T15:00:00.000Z';
const MONDAY = '2032-03-08T19:00:00.000Z';

type P = { home: number; draw: number; away: number };
const P_WON: P = { home: 0.5, draw: 0.3, away: 0.2 }; // the home side won 2-1
const P_WON_EARLY: P = { home: 0.2, draw: 0.3, away: 0.5 }; // superseded before kick-off
const P_DRAWN: P = { home: 0.1, draw: 0.3, away: 0.6 }; // a 1-1 draw
const P_DRAWN_SHADOW: P = { home: 0.2, draw: 0.3, away: 0.5 };
const P_NEW: P = { home: 0.25, draw: 0.25, away: 0.5 }; // 0-2: only the shadow forecast it

const brier = (p: P, outcome: keyof P) =>
  (['home', 'draw', 'away'] as const).reduce(
    (sum, k) => sum + (p[k] - (k === outcome ? 1 : 0)) ** 2,
    0,
  );

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('console model page', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let cookie = '';
  const won = randomUUID();
  const drawn = randomUUID();
  const fresh = randomUUID();
  const late = randomUUID();
  const username = `cm_${RUN}`;

  const version = (
    fixture: string,
    kickoff: string,
    role: 'published' | 'shadow',
    modelId: string,
    computedAt: string,
    p: P,
  ): NewForecast => ({
    fixtureId: fixture,
    kind: 'early',
    role,
    modelId,
    request: {
      fixture_id: fixture,
      home_team_id: HOME,
      away_team_id: AWAY,
      division: 'E0',
      kickoff_at: kickoff,
    },
    computedAt: new Date(computedAt),
    available: {
      probabilities: p,
      expectedGoals: { home: 1.4, away: 1.1 },
      mostLikely: [{ home: 1, away: 1, probability: 0.12 }],
      leadingFactors: [],
      inputs: {
        model_version: modelId,
        fit_date: '2032-03-01',
        matches_used: 100,
        elo_used: true,
        history_from: '2029-03-01',
        data_completeness: 'available',
      },
    },
    unavailable: null,
  });

  const get = (who: string | null) =>
    app.inject({
      method: 'GET',
      url: '/console/model',
      headers: who === null ? {} : { cookie: `fmip_console=${who}` },
    });

  beforeAll(async () => {
    // The model service names both versions, so the figures are this run's alone.
    const health = {
      status: 'ok',
      service: 'model',
      model_version: PUBLISHED,
      candidate_versions: [SHADOW],
      checked_at: new Date().toISOString(),
    };
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, ConsoleModelModule],
    })
      .overrideProvider(CONSOLE_OPTIONS)
      .useValue({ secret: SECRET, cookieSecure: false })
      .overrideProvider(MODEL_CLIENT)
      .useValue(
        new ModelClient({
          baseUrl: 'http://model.test',
          fetchImpl: (url) =>
            String(url).endsWith('/health')
              ? Promise.resolve(new Response(JSON.stringify(health), { status: 200 }))
              : Promise.reject(new Error('unused')),
        }),
      )
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    pool = new Pool({ connectionString: DATABASE_URL });

    for (const [id, kickoff] of [
      [won, SUNDAY],
      [drawn, MONDAY],
      [fresh, MONDAY],
      [late, MONDAY],
    ] as const) {
      await pool.query(
        `INSERT INTO fixture (id, season_id, round, kickoff_at, status)
         VALUES ($1, $2, 'Console model test', $3, 'finished')`,
        [id, SEASON, kickoff],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, HOME, AWAY],
      );
    }
    const forecasts = new PostgresForecastStore(pool);
    const at = (iso: string) => iso;
    await forecasts.record(
      version(won, SUNDAY, 'published', PUBLISHED, at('2032-03-05T10:00:00Z'), P_WON_EARLY),
    );
    await forecasts.record(
      version(won, SUNDAY, 'published', PUBLISHED, at('2032-03-06T10:00:00Z'), P_WON),
    );
    await forecasts.record(
      version(won, SUNDAY, 'shadow', SHADOW, at('2032-03-06T10:00:00Z'), P_WON),
    );
    await forecasts.record(
      version(drawn, MONDAY, 'published', PUBLISHED, at('2032-03-07T10:00:00Z'), P_DRAWN),
    );
    await forecasts.record(
      version(drawn, MONDAY, 'shadow', SHADOW, at('2032-03-07T10:00:00Z'), P_DRAWN_SHADOW),
    );
    await forecasts.record(
      version(fresh, MONDAY, 'shadow', SHADOW, at('2032-03-07T10:00:00Z'), P_NEW),
    );
    // After kick-off: evaluated, never counted (D-031).
    await forecasts.record(
      version(late, MONDAY, 'published', PUBLISHED, at('2032-03-08T20:00:00Z'), P_WON),
    );
    await pool.query(
      `INSERT INTO fixture_score (fixture_id, kind, home, away)
       VALUES ($1, 'full_time', 2, 1), ($2, 'full_time', 1, 1), ($3, 'full_time', 0, 2),
              ($4, 'full_time', 3, 0)`,
      [won, drawn, fresh, late],
    );
    const evaluations = new EvaluationService(new PostgresEvaluationStore(pool));
    for (const id of [won, drawn, fresh, late]) await evaluations.evaluateFixture(id);

    // A console account and a session, as an accepted invitation leaves them.
    const store = app.get(PostgresConsoleStore);
    const invitation = newToken();
    await store.createInvitation(
      hashToken(consoleTokenText(invitation), SECRET),
      `CM ${RUN}`,
      new Date(Date.now() + 3_600_000),
    );
    const accepted = await store.acceptInvitation(
      hashToken(consoleTokenText(invitation), SECRET),
      username,
      await hashPassword('a perfectly fine passphrase'),
    );
    if (accepted.kind !== 'ok') throw new Error(`invitation: ${accepted.kind}`);
    cookie = newToken();
    await store.createSession(accepted.user.id, hashToken(consoleTokenText(cookie), SECRET));
  }, 60_000);

  afterAll(async () => {
    await withTriggersOff(pool, async (client) => {
      for (const id of [won, drawn, fresh, late]) {
        await client.query(`DELETE FROM evaluation WHERE fixture_id = $1`, [id]);
        await client.query(`DELETE FROM forecast WHERE fixture_id = $1`, [id]);
        await client.query(`DELETE FROM input_snapshot WHERE fixture_id = $1`, [id]);
        await client.query(`DELETE FROM fixture_score WHERE fixture_id = $1`, [id]);
        await client.query(`DELETE FROM fixture_participant WHERE fixture_id = $1`, [id]);
        await client.query(`DELETE FROM fixture WHERE id = $1`, [id]);
      }
      await client.query(`DELETE FROM model_version WHERE model_id IN ($1, $2)`, [
        PUBLISHED,
        SHADOW,
      ]);
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM console_user WHERE username = $1`,
        [username],
      );
      const ids = rows.map((r) => r.id);
      await client.query(`DELETE FROM console_audit WHERE actor_id = ANY($1::uuid[])`, [ids]);
      await client.query(
        `DELETE FROM console_invite WHERE used_by = ANY($1::uuid[]) OR display_name = $2`,
        [ids, `CM ${RUN}`],
      );
    });
    await pool.query(`DELETE FROM console_user WHERE username = $1`, [username]);
    await pool.end();
    await app.close();
  });

  it('refuses without a console session, and with a token that names none', async () => {
    const none = await get(null);
    expect(none.statusCode).toBe(401);
    expect(none.json()).toMatchObject({ error: 'unauthenticated' });
    expect((await get(newToken())).statusCode).toBe(401);
  });

  it("computes the published version's record and the candidate's counts from the evaluations", async () => {
    const response = await get(cookie);
    expect(response.statusCode).toBe(200);
    const body = response.json() as ConsoleModelReport;
    expect(body.service).toBe('answered');
    expect(body.reference.uniform_log_loss).toBeCloseTo(Math.log(3), 5);

    // Two matches: the late forecast is not counted, and the won match counts its last version.
    const record = body.published?.record;
    expect(body.published?.model_version).toBe(PUBLISHED);
    expect(body.published?.since).toBe('2032-03-05T10:00:00.000Z');
    expect(record?.matches).toBe(2);
    expect(record?.coverage).toBe('limited');
    expect(record?.log_loss?.mean).toBeCloseTo((-Math.log(0.5) - Math.log(0.3)) / 2, 5);
    expect(record?.brier?.mean).toBeCloseTo((brier(P_WON, 'home') + brier(P_DRAWN, 'draw')) / 2, 5);
    expect(record?.accuracy?.mean).toBe(0.5);
    expect(record?.log_loss?.low).not.toBeNull();
    expect(record?.first_kickoff_at).toBe(SUNDAY);
    expect(record?.last_kickoff_at).toBe(MONDAY);

    // Calibration: each outcome's probability in ten-point bands, over the same two matches.
    const band = (outcome: string, b: number) =>
      body.calibration.find((c) => c.outcome === outcome && c.band === b);
    expect(band('home', 5)).toMatchObject({ forecasts: 1, said: 0.5, seen: { mean: 1 } });
    expect(band('home', 1)).toMatchObject({ forecasts: 1, seen: { mean: 0 } });
    expect(band('draw', 3)).toMatchObject({ forecasts: 2, said: 0.3, seen: { mean: 0.5 } });
    expect(body.calibration.reduce((sum, c) => sum + c.forecasts, 0)).toBe(6);

    // The trend is the console's weekly series: a Sunday and a Monday, two ISO weeks.
    expect(body.trend.map((p) => [p.period_start, p.matches])).toEqual([
      ['2032-03-01', 1],
      ['2032-03-08', 1],
    ]);

    expect(body.competitions).toHaveLength(1);
    expect(body.competitions[0]?.competition.id).toBe(COMPETITION);
    expect(body.competitions[0]?.record.matches).toBe(2);

    // The candidate: three of its own, two paired (one identical), one only it forecast.
    expect(body.candidates).toHaveLength(1);
    const candidate = body.candidates[0];
    expect(candidate?.model_version).toBe(SHADOW);
    expect(candidate?.in_service).toBe(true);
    expect(candidate?.own.matches).toBe(3);
    expect(candidate?.paired).toEqual({ matches: 2, identical: 1, figures: null });
    expect(candidate?.new_divisions).toEqual({ matches: 1, log_loss: null });
  });
});
