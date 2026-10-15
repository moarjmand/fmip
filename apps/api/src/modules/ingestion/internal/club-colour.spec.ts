import type { NormalisedFixture, NormalisedLineup } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IngestStore, type PollTarget, type RefResolver } from './ingest-store';

/**
 * A club's colour from the shirts it wore at home (T-1416, D-218): each
 * line-up's shirts are stored on the match, and the club's colour is the
 * one worn most often in its latest ten home matches with a shirt -- unless
 * an editor set one, which the shirts never overwrite.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const PREMIER_LEAGUE = '00000000-0000-4000-8000-000000000201';
const PL_2025 = '00000000-0000-4000-8000-000000000302';
const UNITED = '00000000-0000-4000-8000-000000000601';
const LIVERPOOL = '00000000-0000-4000-8000-000000000602';

const TARGET: PollTarget = {
  competitionId: PREMIER_LEAGUE,
  competitionExternalId: 't1416-league',
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

function match(externalId: string, kickoffAt: string): NormalisedFixture {
  return {
    externalId,
    competition: { externalId: 'another-league', name: 'Premier League' },
    season: { label: '2025/26' },
    stage: null,
    round: null,
    kickoffAt,
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

function shirts(externalId: string, home: string | null, away: string | null): NormalisedLineup {
  return {
    fixtureExternalId: externalId,
    home: { formation: null, coach: null, players: [], kitColour: home },
    away: { formation: null, coach: null, players: [], kitColour: away },
  };
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'a club’s colour from its home shirts',
  () => {
    let pool: Pool;
    let store: IngestStore;
    const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-6);
    const written: string[] = [];

    async function played(n: number, home: string | null, away: string | null): Promise<string> {
      const externalId = `t1416-${RUN}-${n}`;
      // Far in the past, so the seeded matches never count among the latest.
      const kickoff = `2026-0${n}-01T15:00:00Z`;
      const write = await store.saveFixture(
        'api_football',
        TARGET,
        match(externalId, kickoff),
        'fixtures',
      );
      const fixtureId = write.fixtureId;
      if (fixtureId === undefined) throw new Error('the match was not written');
      written.push(fixtureId);
      await store.saveLineup('api_football', fixtureId, shirts(externalId, home, away));
      return fixtureId;
    }

    const colourOf = async (teamId: string) =>
      (
        await pool.query<{ colour: string | null; colour_source: string | null }>(
          `SELECT colour, colour_source FROM team WHERE id = $1`,
          [teamId],
        )
      ).rows[0];

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      store = new IngestStore(pool, TEAMS);
      // The seeded clubs carry no stored shirts; this suite owns their colour.
      await pool.query(
        `UPDATE fixture_participant SET kit_colour = NULL WHERE team_id = ANY($1::uuid[])`,
        [[UNITED, LIVERPOOL]],
      );
      await pool.query(
        `UPDATE team SET colour = NULL, colour_source = NULL WHERE id = ANY($1::uuid[])`,
        [[UNITED, LIVERPOOL]],
      );
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await pool.query(
        `DELETE FROM provider_mapping WHERE entity_type = 'fixture' AND internal_id = ANY($1::uuid[])`,
        [written],
      );
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [written]);
      await pool.query(
        `UPDATE team SET colour = NULL, colour_source = NULL WHERE id = ANY($1::uuid[])`,
        [[UNITED, LIVERPOOL]],
      );
      await pool.end();
    });

    it('keeps each side’s shirt on the match, and colours the club by its home shirts', async () => {
      const first = await played(1, '#da291c', '#ffffff');
      const { rows } = await pool.query<{ side: string; kit_colour: string | null }>(
        `SELECT side, kit_colour FROM fixture_participant WHERE fixture_id = $1 ORDER BY side`,
        [first],
      );
      expect(rows).toEqual([
        { side: 'away', kit_colour: '#ffffff' },
        { side: 'home', kit_colour: '#da291c' },
      ]);
      expect(await colourOf(UNITED)).toEqual({ colour: '#da291c', colour_source: 'kits' });
      // Liverpool only played away here: an away shirt says nothing of a club.
      expect(await colourOf(LIVERPOOL)).toEqual({ colour: null, colour_source: null });
    });

    it('takes the shirt worn most often, the latest breaking a tie, and keeps a shirt an answer leaves out', async () => {
      await played(2, '#000000', null);
      // One red, one black: the tie goes to the latest, black.
      expect((await colourOf(UNITED))?.colour).toBe('#000000');
      await played(3, '#da291c', null);
      expect((await colourOf(UNITED))?.colour).toBe('#da291c');

      // An answer without a shirt keeps the one stored.
      const again = written[0]!;
      await store.saveLineup('api_football', again, shirts(`t1416-${RUN}-1`, null, null));
      const { rows } = await pool.query<{ kit_colour: string | null }>(
        `SELECT kit_colour FROM fixture_participant WHERE fixture_id = $1 AND side = 'home'`,
        [again],
      );
      expect(rows[0]?.kit_colour).toBe('#da291c');
    });

    it('never overwrites a colour an editor set', async () => {
      await pool.query(
        `UPDATE team SET colour = '#123456', colour_source = 'editor' WHERE id = $1`,
        [UNITED],
      );
      await played(4, '#000000', null);
      expect(await colourOf(UNITED)).toEqual({ colour: '#123456', colour_source: 'editor' });
    });
  },
);
