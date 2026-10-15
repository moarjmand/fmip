import type { NormalisedFixture } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTriggersOff } from '../../../testing/cleanup';
import { IngestStore, type PollTarget, type RefResolver } from './ingest-store';

/**
 * A match the provider turns round (T-1410): the daily sweep of 2026-10-14
 * failed whole on `fixture_participant_team_once` because fixture 1552933
 * came back with home and away the other way about.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const UNITED = '00000000-0000-4000-8000-000000000601';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';

const TARGET: PollTarget = {
  competitionId: PREMIER_LEAGUE,
  competitionExternalId: 't1410-league',
  seasonId: PL_2025,
  seasonLabel: '2025/26',
  seasonStart: '2025-08-15',
  seasonEnd: '2026-05-24',
};

const TEAMS: RefResolver = {
  resolve: (ref) => {
    if (ref.entityType === 'team' && ref.externalId === 'united') {
      return Promise.resolve({ kind: 'resolved', internalId: UNITED });
    }
    if (ref.entityType === 'team' && ref.externalId === 'liverpool') {
      return Promise.resolve({ kind: 'resolved', internalId: LIVERPOOL });
    }
    return Promise.resolve({ kind: 'unresolved' });
  },
  link: () => Promise.resolve({ kind: 'linked' }),
};

function match(externalId: string, home: string, away: string): NormalisedFixture {
  return {
    externalId,
    competition: { externalId: 'another-league', name: 'Premier League' },
    season: { label: '2025/26' },
    stage: null,
    round: null,
    kickoffAt: '2026-03-06T16:00:00Z',
    status: 'scheduled',
    minute: null,
    home: { externalId: home, name: home },
    away: { externalId: away, name: away },
    venue: null,
    referee: null,
    scores: {
      current: null,
      halfTime: null,
      fullTime: null,
      extraTime: null,
      penalties: null,
      aggregate: null,
    },
  } as unknown as NormalisedFixture;
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('a match turned round', () => {
  let pool: Pool;
  let store: IngestStore;
  const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-6);
  const written: string[] = [];
  const versions: string[] = [];

  /** Writes the match once and maps it, as the resolver's `link` does in production. */
  async function stored(externalId: string): Promise<string> {
    const first = await store.saveFixture(
      'api_football',
      TARGET,
      match(externalId, 'united', 'liverpool'),
      'fixtures',
    );
    const fixtureId = first.fixtureId;
    if (fixtureId === undefined) throw new Error('the match was not written');
    written.push(fixtureId);
    await pool.query(
      `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
       VALUES ('api_football', 'fixture', $1, $2)`,
      [externalId, fixtureId],
    );
    return fixtureId;
  }

  async function sides(fixtureId: string): Promise<Record<string, string>> {
    const { rows } = await pool.query<{ side: string; team_id: string }>(
      `SELECT side, team_id FROM fixture_participant WHERE fixture_id = $1`,
      [fixtureId],
    );
    return Object.fromEntries(rows.map((row) => [row.side, row.team_id]));
  }

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new IngestStore(pool, TEAMS);
  });

  afterAll(async () => {
    if (pool === undefined) return;
    await withTriggersOff(pool, async (client) => {
      await client.query(`DELETE FROM forecast WHERE fixture_id = ANY($1::uuid[])`, [written]);
      await client.query(`DELETE FROM input_snapshot WHERE fixture_id = ANY($1::uuid[])`, [
        written,
      ]);
      await client.query(`DELETE FROM model_version WHERE id = ANY($1::uuid[])`, [versions]);
    });
    await pool.query(
      `DELETE FROM provider_mapping WHERE entity_type = 'fixture' AND internal_id = ANY($1::uuid[])`,
      [written],
    );
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [written]);
    await pool.end();
  });

  it('writes the new sides when nothing hangs off the match yet', async () => {
    const fixtureId = await stored(`t1410-a-${RUN}`);

    const write = await store.saveFixture(
      'api_football',
      TARGET,
      match(`t1410-a-${RUN}`, 'liverpool', 'united'),
      'fixtures',
    );

    expect(write.refused).toBeUndefined();
    expect(write.changed).toBeGreaterThan(0);
    expect(await sides(fixtureId)).toEqual({ home: LIVERPOOL, away: UNITED });
  });

  it('holds the match and says why once something reads its sides', async () => {
    const fixtureId = await stored(`t1410-b-${RUN}`);
    await pool.query(
      `INSERT INTO fixture_stat (participant_id, metric, value)
       SELECT id, 'corners', 3 FROM fixture_participant WHERE fixture_id = $1 AND side = 'home'`,
      [fixtureId],
    );

    const write = await store.saveFixture(
      'api_football',
      TARGET,
      match(`t1410-b-${RUN}`, 'liverpool', 'united'),
      'fixtures',
    );

    expect(write.changed).toBe(0);
    expect(write.refused).toContain('home and away swapped');
    expect(await sides(fixtureId)).toEqual({ home: UNITED, away: LIVERPOOL });
  });

  it('turns a match round when its only forecast is unavailable', async () => {
    const fixtureId = await stored(`t1412-${RUN}`);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO model_version (model_id) VALUES ($1) RETURNING id`,
      [`t1412-${RUN}@0.0.1`],
    );
    const versionId = rows[0]?.id ?? '';
    versions.push(versionId);
    await pool.query(
      `WITH snapshot AS (
         INSERT INTO input_snapshot (fixture_id, model_version_id, kind, request)
         VALUES ($1, $2, 'early', '{}') RETURNING id)
       INSERT INTO forecast (fixture_id, input_snapshot_id, model_version_id, version_number,
                             computed_at, status, unavailable_reason)
       SELECT $1, id, $2, 1, now(), 'unavailable', 'competition_not_mapped' FROM snapshot`,
      [fixtureId, versionId],
    );

    const write = await store.saveFixture(
      'api_football',
      TARGET,
      match(`t1412-${RUN}`, 'liverpool', 'united'),
      'fixtures',
    );

    expect(write.refused).toBeUndefined();
    expect(await sides(fixtureId)).toEqual({ home: LIVERPOOL, away: UNITED });
  });

  it('leaves a match the provider has not turned round alone', async () => {
    const fixtureId = await stored(`t1410-c-${RUN}`);

    const write = await store.saveFixture(
      'api_football',
      TARGET,
      match(`t1410-c-${RUN}`, 'united', 'liverpool'),
      'fixtures',
    );

    expect(write).toMatchObject({ changed: 0 });
    expect(write.refused).toBeUndefined();
    expect(await sides(fixtureId)).toEqual({ home: UNITED, away: LIVERPOOL });
  });
});
