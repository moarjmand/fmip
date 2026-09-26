import { randomUUID } from 'node:crypto';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { ChannelPostHealth, ForecastListEntry, ForecastVersion } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { ForecastService } from '../forecast/forecast.service';
import {
  CHANNEL_POST_CONFIG,
  ChannelRefusal,
  type ChannelPostConfig,
  type ChannelPublisher,
} from './channel-post.port';
import { ChannelPostModule } from './channel-post.module';
import { ChannelPostService } from './channel-post.service';

/**
 * The daily post against the real schema (T-525): the day is claimed once
 * however many instances tick at the same moment, a refused day is taken
 * over while a failed one never is, a day with no match leaves no row, the
 * post links every match and carries only the published model's numbers,
 * and `/health/channel` reports the newest day. The channel is a fake that
 * records what it was given; nothing here reaches a network.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const PL_2024 = '00000000-0000-4000-8000-000000000301';
const CONTINENTAL_2025 = '00000000-0000-4000-8000-000000000303';
const MAN_UNITED = '00000000-0000-4000-8000-000000000601';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';
const REAL_MADRID = '00000000-0000-4000-8000-000000000603';
const PERSEPOLIS = '00000000-0000-4000-8000-000000000604';

// Days in 2094 that no seed or other suite touches, a different handful per
// run so two runs against one database never share a day.
const BASE = Date.UTC(2094, 0, 1) + (Date.now() % 300) * 86_400_000;
const day = (offset: number): string =>
  new Date(BASE + offset * 86_400_000).toISOString().slice(0, 10);
const at = (d: string, time: string): Date => new Date(`${d}T${time}Z`);
const MATCH_DAY = day(0);
const EMPTY_DAY = day(1);
const REFUSED_DAY = day(2);
const FAILED_DAY = day(3);

const LIVERPOOL_HOME = randomUUID();
const CONTINENTAL = randomUUID();
const FINISHED = randomUUID();
const fixtureIds = [LIVERPOOL_HOME, CONTINENTAL, FINISHED];

class CapturingChannel implements ChannelPublisher {
  readonly provider = 'capture';
  readonly posted: string[] = [];
  readonly answers: (Error | null)[] = [];
  async post(text: string): Promise<void> {
    // A pause, so that two instances ticking together overlap for real.
    await new Promise((resolve) => setTimeout(resolve, 20));
    const answer = this.answers.shift() ?? null;
    if (answer !== null) throw answer;
    this.posted.push(text);
  }
}

function published(fixtureId: string): ForecastVersion {
  return {
    id: randomUUID(),
    fixture_id: fixtureId,
    version_number: 3,
    kind: 'lineups_confirmed',
    model_version: 'dixon-coles@9.9.9',
    computed_at: '2094-01-01T00:00:00.000Z',
    status: 'available',
    probabilities: { home: 0.5, draw: 0.3, away: 0.2 },
    expected_goals: null,
    most_likely_scorelines: null,
    leading_factors: null,
    data_completeness: 'available',
    inputs: null,
    unavailable_reason: null,
    unavailable_detail: null,
  };
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the daily channel post', () => {
  let app: NestFastifyApplication;
  let pool: Pool;
  let service: ChannelPostService;
  const channel = new CapturingChannel();
  const config: ChannelPostConfig = {
    publisher: channel,
    postHour: 6,
    origin: 'https://fmip.example',
  };
  // The published model's latest version for one match; none for the other.
  const forecasts = {
    latestFor: async (ids: string[]): Promise<ForecastListEntry[]> =>
      ids.map((id) => ({ fixture_id: id, latest: id === LIVERPOOL_HOME ? published(id) : null })),
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule, ChannelPostModule],
    })
      .overrideProvider(CHANNEL_POST_CONFIG)
      .useValue(config)
      .overrideProvider(ForecastService)
      .useValue(forecasts)
      .compile();
    app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    service = app.get(ChannelPostService);
    pool = new Pool({ connectionString: DATABASE_URL });

    // The match day: a Premier League match and a continental one still to
    // come, and one already finished that morning, which is not posted. The
    // refused and failed days reuse the first match's shape on their own day.
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES
         ($1, $4, $5::timestamptz, 'scheduled'),
         ($2, $6, $7::timestamptz, 'scheduled'),
         ($3, $4, $8::timestamptz, 'finished')`,
      [
        LIVERPOOL_HOME,
        CONTINENTAL,
        FINISHED,
        PL_2024,
        `${MATCH_DAY}T19:00:00Z`,
        CONTINENTAL_2025,
        `${MATCH_DAY}T20:00:00Z`,
        `${MATCH_DAY}T03:00:00Z`,
      ],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES
         ($1, $4, 'home'), ($1, $5, 'away'),
         ($2, $6, 'home'), ($2, $7, 'away'),
         ($3, $5, 'home'), ($3, $4, 'away')`,
      [LIVERPOOL_HOME, CONTINENTAL, FINISHED, LIVERPOOL, MAN_UNITED, REAL_MADRID, PERSEPOLIS],
    );
    for (const d of [REFUSED_DAY, FAILED_DAY]) {
      const fixture = randomUUID();
      fixtureIds.push(fixture);
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3::timestamptz, 'scheduled')`,
        [fixture, PL_2024, `${d}T19:00:00Z`],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side) VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [fixture, LIVERPOOL, MAN_UNITED],
      );
    }
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM channel_post WHERE day = ANY($1::date[])`, [
      [MATCH_DAY, EMPTY_DAY, REFUSED_DAY, FAILED_DAY],
    ]);
    await pool.query(`DELETE FROM fixture_participant WHERE fixture_id = ANY($1::uuid[])`, [
      fixtureIds,
    ]);
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtureIds]);
    await pool.end();
    await app.close();
  });

  it('posts the day once, however many instances tick at the same moment', async () => {
    const outcomes = await Promise.all(
      Array.from({ length: 4 }, () => service.run(at(MATCH_DAY, '06:41:00'))),
    );
    expect(outcomes.filter((o) => o.kind === 'sent')).toHaveLength(1);
    expect(outcomes.filter((o) => o.kind === 'already')).toHaveLength(3);
    expect(channel.posted).toHaveLength(1);

    const text = channel.posted[0] ?? '';
    expect(text.split('\n')[0]).toContain("The statistical model's forecast");
    expect(text).toContain('(dixon-coles@9.9.9)');
    expect(text).toContain(`https://fmip.example/en/match/${LIVERPOOL_HOME}`);
    expect(text).toContain(`https://fmip.example/en/match/${CONTINENTAL}`);
    expect(text).not.toContain(FINISHED);
    expect(text).toMatch(/Liverpool 50% · Draw 30% · Manchester United 20%/);
    expect(text).toContain('No forecast from the statistical model');

    const { rows } = await pool.query(
      `SELECT state, delivered, fixtures, forecasts, model_versions, attempts, messages
         FROM channel_post WHERE day = $1::date`,
      [MATCH_DAY],
    );
    expect(rows).toEqual([
      {
        state: 'sent',
        delivered: 1,
        fixtures: 2,
        forecasts: 1,
        model_versions: ['dixon-coles@9.9.9'],
        attempts: 1,
        messages: [text],
      },
    ]);

    // A restart, a later tick, another instance: the day is on record.
    expect(await service.run(at(MATCH_DAY, '09:41:00'))).toEqual({
      kind: 'already',
      day: MATCH_DAY,
      state: 'sent',
    });
    expect(channel.posted).toHaveLength(1);
  });

  it('posts nothing and records nothing on a day with no match', async () => {
    expect(await service.run(at(EMPTY_DAY, '06:41:00'))).toEqual({
      kind: 'nothing',
      day: EMPTY_DAY,
    });
    const { rowCount } = await pool.query(`SELECT 1 FROM channel_post WHERE day = $1::date`, [
      EMPTY_DAY,
    ]);
    expect(rowCount).toBe(0);
  });

  it('takes a refused day over later, and never a failed one', async () => {
    const before = channel.posted.length;
    channel.answers.push(new ChannelRefusal('capture refused (403): not an administrator'));
    expect(await service.run(at(REFUSED_DAY, '06:41:00'))).toMatchObject({ kind: 'refused' });
    const retried = await Promise.all([
      service.run(at(REFUSED_DAY, '07:41:00')),
      service.run(at(REFUSED_DAY, '07:41:00')),
    ]);
    expect(retried.filter((o) => o.kind === 'sent')).toHaveLength(1);
    const refused = await pool.query(
      `SELECT state, attempts, failure FROM channel_post WHERE day = $1::date`,
      [REFUSED_DAY],
    );
    expect(refused.rows).toEqual([{ state: 'sent', attempts: 2, failure: null }]);

    channel.answers.push(new Error('capture unreachable: TimeoutError'));
    expect(await service.run(at(FAILED_DAY, '06:41:00'))).toMatchObject({ kind: 'failed' });
    expect(await service.run(at(FAILED_DAY, '07:41:00'))).toMatchObject({
      kind: 'already',
      state: 'failed',
    });
    expect(channel.posted.length).toBe(before + 1);
  });

  it('refuses to record an empty post at all', async () => {
    await expect(
      pool.query(
        `INSERT INTO channel_post (day, provider, messages, fixtures, forecasts, model_versions)
         VALUES ($1::date, 'capture', '{}'::text[], 0, 0, '{}'::text[])`,
        [EMPTY_DAY],
      ),
    ).rejects.toThrow(/check constraint/);
  });

  it('reports the channel and the newest day on /health/channel', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/channel' });
    expect(response.statusCode).toBe(200);
    const health = response.json() as ChannelPostHealth;
    expect(health.channel).toEqual({ state: 'configured', provider: 'capture' });
    expect(health.scheduled).toBe(false);
    expect(health.post_hour_utc).toBe(6);
    expect(health.last).not.toBeNull();
  });
});
