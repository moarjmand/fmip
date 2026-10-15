import type { NormalisedFixture } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IngestStore, type PollTarget, type RefResolver } from './ingest-store';
import { KitColourStore } from './kit-colour-store';

/**
 * The `kit_colours` job's SQL (T-1417, D-218) on a database: a finished match
 * with a stored line-up and a side without a shirt is owed an ask; an
 * answered one never again; an unanswered one again only after the retry
 * wait, and not past the attempts.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const UNITED = '00000000-0000-4000-8000-000000000601';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';

const TARGET: PollTarget = {
  competitionId: PREMIER_LEAGUE,
  competitionExternalId: 't1417-league',
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

function match(externalId: string): NormalisedFixture {
  return {
    externalId,
    competition: { externalId: 'another-league', name: 'Premier League' },
    season: { label: '2025/26' },
    stage: null,
    round: null,
    kickoffAt: '2026-02-01T15:00:00Z',
    status: 'scheduled',
    minute: null,
    home: { externalId: 'united', name: 'united' },
    away: { externalId: 'liverpool', name: 'liverpool' },
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

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'the matches owed their shirts',
  () => {
    let pool: Pool;
    let kits: KitColourStore;
    const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-6);
    const externalId = `t1417-${RUN}`;
    let fixtureId = '';

    const owed = async (askedBefore: string) =>
      (await kits.matchesOwedShirts('api_football', askedBefore, 5, 50_000)).filter(
        (m) => m.fixtureId === fixtureId,
      );
    const later = '2999-01-01T00:00:00Z';

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      kits = new KitColourStore(pool);
      const store = new IngestStore(pool, TEAMS);
      const write = await store.saveFixture('api_football', TARGET, match(externalId), 'fixtures');
      fixtureId = write.fixtureId ?? '';
      await pool.query(
        `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
         VALUES ('api_football', 'fixture', $1, $2)`,
        [externalId, fixtureId],
      );
      await pool.query(`UPDATE fixture SET status = 'finished' WHERE id = $1`, [fixtureId]);
      const person = await pool.query<{ id: string }>(`SELECT id FROM person LIMIT 1`);
      await pool.query(
        `INSERT INTO lineup (participant_id, person_id, role)
         SELECT fp.id, $2, 'starter' FROM fixture_participant fp
          WHERE fp.fixture_id = $1 AND fp.side = 'home'`,
        [fixtureId, person.rows[0]?.id],
      );
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await pool.query(
        `DELETE FROM provider_mapping WHERE entity_type = 'fixture' AND internal_id = $1`,
        [fixtureId],
      );
      await pool.query(`DELETE FROM fixture WHERE id = $1`, [fixtureId]);
      await pool.end();
    });

    it('owes a finished match with a line-up and no shirt, once answered never again', async () => {
      expect(await owed(later)).toEqual([{ fixtureId, externalId }]);

      await kits.markShirtsAsked('api_football', fixtureId);
      // Asked just now: not again before the retry wait.
      expect(await owed('2000-01-01T00:00:00Z')).toEqual([]);
      expect(await owed(later)).toHaveLength(1);

      await kits.markShirtsAnswered('api_football', fixtureId, 0);
      expect(await owed(later)).toEqual([]);
      const { rows } = await pool.query<{ attempts: number; shirts: number }>(
        `SELECT attempts, shirts FROM fixture_kit_fetch WHERE fixture_id = $1`,
        [fixtureId],
      );
      expect(rows[0]).toEqual({ attempts: 2, shirts: 0 });
    });

    it('stops asking after the attempts', async () => {
      await pool.query(`DELETE FROM fixture_kit_fetch WHERE fixture_id = $1`, [fixtureId]);
      for (let i = 0; i < 5; i += 1) await kits.markShirtsAsked('api_football', fixtureId);
      expect(await owed(later)).toEqual([]);
    });
  },
);
