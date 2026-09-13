import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { PowerIndexService } from './power-index.service';

// The Power Index against the real training store (T-111): the development
// database holds a full 2024/25 Premier League season, and the seed already maps
// Manchester United and Liverpool to the names that season uses. So this
// measures two real teams against a real league, not a fabricated one.
const DATABASE_URL = process.env.DATABASE_URL;

const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
const MAN_UNITED = '00000000-0000-4000-8000-000000000601';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';

const SEASON = randomUUID();
const FIXTURE = randomUUID();
const EARLIER = randomUUID();
// After the 2024/25 season the training store ends on, so all of it is history.
const KICKOFF = '2025-08-16T14:00:00Z';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the power index', () => {
  let pool: Pool;
  let service: PowerIndexService;
  let close: () => Promise<void>;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });

    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, '2025/26 power index test', '2025-08-01', '2026-05-30', false)`,
      [SEASON, PREMIER_LEAGUE],
    );
    // A match three days and twenty hours before kick-off, so rest is
    // measurable and short: whole days elapsed, which is three.
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'finished')`,
      [EARLIER, SEASON, '2025-08-12T18:00:00Z'],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [EARLIER, MAN_UNITED, LIVERPOOL],
    );
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'scheduled')`,
      [FIXTURE, SEASON, KICKOFF],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [FIXTURE, MAN_UNITED, LIVERPOOL],
    );

    // The service alone, not the whole forecast boundary: the Power Index needs
    // the pool and nothing else, and pulling in the identity and model-client
    // wiring would make this test depend on their environment as well.
    const moduleRef = await Test.createTestingModule({
      imports: [DatabaseModule],
      providers: [PowerIndexService],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(PowerIndexService);
    close = () => moduleRef.close();
  });

  afterAll(async () => {
    if (pool === undefined) return;
    await pool.query(`ALTER TABLE power_index DISABLE TRIGGER power_index_immutable`);
    await pool.query(
      `DELETE FROM power_index WHERE participant_id IN
         (SELECT id FROM fixture_participant WHERE fixture_id = ANY($1::uuid[]))`,
      [[FIXTURE, EARLIER]],
    );
    await pool.query(`ALTER TABLE power_index ENABLE TRIGGER power_index_immutable`);
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [[FIXTURE, EARLIER]]);
    await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
    await pool.end();
    await close?.();
  });

  it('measures both sides against a real season, and says what it could not reach', async () => {
    const outcome = await service.compute(FIXTURE, new Date('2025-08-15T09:00:00Z'));
    expect(outcome.kind).toBe('computed');
    if (outcome.kind !== 'computed') return;

    for (const index of [outcome.pair.home, outcome.pair.away]) {
      expect(index.value).toBeGreaterThanOrEqual(0);
      expect(index.value).toBeLessThanOrEqual(100);
      // Five of the seven components arrive on this data; line-up quality,
      // managerial stability and competition context do not (D-049).
      expect(index.completeness).toBeCloseTo(0.7, 4);
      const absent = index.components.filter((c) => c.state === 'not_supplied');
      expect(absent.map((c) => c.key).sort()).toEqual([
        'competition_context',
        'lineup_quality',
        'stability',
      ]);
      expect(absent.every((c) => (c.note ?? '') !== '')).toBe(true);
    }

    // Liverpool won the 2024/25 Premier League and Manchester United finished
    // fifteenth, so any honest strength measure has to separate them.
    const united = outcome.pair.home.components.find((c) => c.key === 'underlying_strength');
    const liverpool = outcome.pair.away.components.find((c) => c.key === 'underlying_strength');
    expect(liverpool?.value as number).toBeGreaterThan(united?.value as number);
    expect(outcome.pair.away.value).toBeGreaterThan(outcome.pair.home.value);
  });

  it('measures rest from the real schedule, and never calls it complete', async () => {
    const outcome = await service.compute(FIXTURE, new Date('2025-08-15T09:30:00Z'));
    if (outcome.kind !== 'computed') throw new Error('expected an index');

    const rest = outcome.pair.home.components.find((c) => c.key === 'rest_and_congestion');
    // Three whole days between the two fixtures: inside the curve, so the
    // component is neither 0 nor 1.
    expect(rest?.value as number).toBeGreaterThan(0);
    expect(rest?.value as number).toBeLessThan(1);
    expect(rest?.note).toContain('3 days since the previous match');
    // Travel is the third thing the blueprint names here and is not modelled.
    expect(rest?.state).toBe('limited');
  });

  it('stores each computation as a new immutable row, and reads back the newest', async () => {
    const first = new Date('2025-08-15T10:00:00Z');
    const second = new Date('2025-08-16T10:00:00Z');
    await service.compute(FIXTURE, first);
    await service.compute(FIXTURE, second);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM power_index pi
         JOIN fixture_participant p ON p.id = pi.participant_id
        WHERE p.fixture_id = $1 AND pi.computed_at IN ($2, $3)`,
      [FIXTURE, first, second],
    );
    // Two moments, two sides: four rows, none of them an edit of another.
    expect(Number(rows[0]?.n)).toBe(4);

    const latest = await service.latest(FIXTURE);
    expect(latest?.home.computed_at).toBe(second.toISOString());
    expect(latest?.away.team.id).toBe(LIVERPOOL);
    expect(latest?.home.leading.length).toBeGreaterThan(0);
  });

  it('recomputing at the same instant is the same computation, not a second one', async () => {
    const when = new Date('2025-08-15T11:00:00Z');
    await service.compute(FIXTURE, when);
    await service.compute(FIXTURE, when);

    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM power_index pi
         JOIN fixture_participant p ON p.id = pi.participant_id
        WHERE p.fixture_id = $1 AND pi.computed_at = $2`,
      [FIXTURE, when],
    );
    expect(Number(rows[0]?.n)).toBe(2);
  });

  it('declines, with a reason, for a competition it has no history for', async () => {
    const season = randomUUID();
    const fixture = randomUUID();
    // La Liga maps to SP1, which the development training store holds nothing of.
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, '00000000-0000-4000-8000-000000000202', '2025/26 no-history test', '2025-08-01', '2026-05-30', false)`,
      [season],
    );
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status) VALUES ($1, $2, $3, 'scheduled')`,
      [fixture, season, KICKOFF],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [fixture, MAN_UNITED, LIVERPOOL],
    );

    const outcome = await service.compute(fixture);
    expect(outcome.kind).toBe('not_measurable');
    if (outcome.kind === 'not_measurable') {
      expect(outcome.reason).toContain('SP1');
    }

    await pool.query(`DELETE FROM fixture WHERE id = $1`, [fixture]);
    await pool.query(`DELETE FROM season WHERE id = $1`, [season]);
  });

  it('says so for a fixture it has never heard of', async () => {
    const outcome = await service.compute('00000000-0000-4000-8000-0000000009ff');
    expect(outcome.kind).toBe('unknown_fixture');
  });
});
