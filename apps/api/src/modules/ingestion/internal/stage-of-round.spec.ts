import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IngestStore, type RefResolver } from './ingest-store';

/**
 * A fixture's stage when the adapter reads none from its round (T-1340): the
 * operator's stage owns the round the way `catalog --add-stage` stamps it, so
 * a poll no longer takes the stage back.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';

const NO_RESOLVER: RefResolver = {
  resolve: () => Promise.resolve({ kind: 'unresolved' }),
  link: () => Promise.resolve({ kind: 'linked' }),
};

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('a fixture’s stage', () => {
  let pool: Pool;
  let store: IngestStore;
  const leagueA = randomUUID();
  const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-6);
  const name = `League A ${RUN}`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new IngestStore(pool, NO_RESOLVER);
    await pool.query(
      `INSERT INTO stage (id, season_id, name, kind, sort_order)
       VALUES ($1, $2, $3, 'group', 90)`,
      [leagueA, PL_2025, name],
    );
  });

  afterAll(async () => {
    if (pool === undefined) return;
    await pool.query(`DELETE FROM stage WHERE id = $1`, [leagueA]);
    await pool.end();
  });

  it('takes the stage the adapter named', async () => {
    // The seed's stage is spelt "Regular season"; the name decides, not the round.
    expect(await store.stageId(PL_2025, 'Regular season', 'League A - 3')).toBe(REGULAR_SEASON);
  });

  it('finds the operator’s stage by its round when the adapter named none', async () => {
    expect(await store.stageId(PL_2025, null, `${name} - 1`)).toBe(leagueA);
    expect(await store.stageId(PL_2025, null, name)).toBe(leagueA);
  });

  it('matches a whole stage name only, and nothing without a round', async () => {
    expect(await store.stageId(PL_2025, null, `${name}B - 1`)).toBeNull();
    expect(await store.stageId(PL_2025, null, 'Friendlies 1')).toBeNull();
    expect(await store.stageId(PL_2025, null, null)).toBeNull();
  });
});
