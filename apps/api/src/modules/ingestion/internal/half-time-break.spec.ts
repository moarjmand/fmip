import type { NormalisedFixture, NormalisedLiveFixture } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IngestStore, type PollTarget, type RefResolver } from './ingest-store';

/**
 * The half-time interval (T-1551): the live list says `HT`, and the match
 * centre showed "LIVE · 45′" through the interval because nothing kept it.
 * The store writes what the live list says while the match is live, keeps
 * the stored answer when a list does not say, and clears it once the match
 * is not live.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const UNITED = '00000000-0000-4000-8000-000000000601';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';

const TARGET: PollTarget = {
  competitionId: PREMIER_LEAGUE,
  competitionExternalId: 't1551-league',
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

function match(
  externalId: string,
  status: 'live' | 'finished',
  minute: number | null,
  halfTimeBreak?: boolean,
): NormalisedFixture & Pick<NormalisedLiveFixture, 'halfTimeBreak'> {
  return {
    externalId,
    competition: { externalId: 'another-league', name: 'Premier League' },
    season: { label: '2025/26' },
    stage: null,
    round: null,
    kickoffAt: '2026-03-06T16:00:00Z',
    status,
    minute,
    home: { externalId: 'liverpool', name: 'liverpool' },
    away: { externalId: 'united', name: 'united' },
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
    ...(halfTimeBreak === undefined ? {} : { halfTimeBreak }),
  } as unknown as NormalisedFixture & Pick<NormalisedLiveFixture, 'halfTimeBreak'>;
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the half-time interval', () => {
  let pool: Pool;
  let store: IngestStore;
  const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-6);
  const written: string[] = [];

  async function atHalfTime(fixtureId: string): Promise<boolean> {
    const { rows } = await pool.query<{ at_half_time: boolean }>(
      `SELECT at_half_time FROM fixture WHERE id = $1`,
      [fixtureId],
    );
    return rows[0]?.at_half_time ?? false;
  }

  beforeAll(() => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new IngestStore(pool, TEAMS);
  });

  afterAll(async () => {
    if (pool === undefined) return;
    await pool.query(
      `DELETE FROM provider_mapping WHERE entity_type = 'fixture' AND internal_id = ANY($1::uuid[])`,
      [written],
    );
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [written]);
    await pool.end();
  });

  it('keeps what the live list says, through a list that does not say, until full time', async () => {
    const externalId = `t1551-${RUN}`;
    const first = await store.saveFixture(
      'api_football',
      TARGET,
      match(externalId, 'live', 45, true),
      'live',
    );
    const fixtureId = first.fixtureId;
    if (fixtureId === undefined) throw new Error('the match was not written');
    written.push(fixtureId);
    await pool.query(
      `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
       VALUES ('api_football', 'fixture', $1, $2)`,
      [externalId, fixtureId],
    );
    expect(await atHalfTime(fixtureId)).toBe(true);

    // The hourly fixture list does not say: the interval stands.
    await store.saveFixture('api_football', TARGET, match(externalId, 'live', 45), 'fixtures');
    expect(await atHalfTime(fixtureId)).toBe(true);

    // The second half: the live list says it is over, and that is a change.
    const second = await store.saveFixture(
      'api_football',
      TARGET,
      match(externalId, 'live', 46, false),
      'live',
    );
    expect(second.changed).toBeGreaterThan(0);
    expect(await atHalfTime(fixtureId)).toBe(false);

    // Back at an interval, then full time: a match that is not live is at none.
    await store.saveFixture('api_football', TARGET, match(externalId, 'live', 45, true), 'live');
    expect(await atHalfTime(fixtureId)).toBe(true);
    await store.saveFixture(
      'api_football',
      TARGET,
      match(externalId, 'finished', null),
      'post_match',
    );
    expect(await atHalfTime(fixtureId)).toBe(false);
  });
});
