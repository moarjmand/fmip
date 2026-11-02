import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NormalisedLineup } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IngestStore, type RefResolver } from './ingest-store';

/**
 * A line-up slot labelled "Trialist" (T-1707, D-342). The feed gave both
 * clubs' trialists one provider id, adopted once as one person "Trialist",
 * and six Scottish League Cup matches listed that person for both teams
 * (aud-2026-11-02-01, the auditor's I2). Against the database: the store
 * writes no row for the label, and the repair migration removes the rows
 * written before and nothing else.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const PL_2025 = '00000000-0000-4000-8000-000000000302';
const ENGLAND = '00000000-0000-4000-8000-000000000101';

const MIGRATION = resolve(
  __dirname,
  '../../../../../../packages/db/migrations/1765900600000_placeholder-lineup-persons.sql',
);

/** The migration's Up section: deletes only, so running it again is harmless. */
function repairSql(): string {
  const [up = ''] = readFileSync(MIGRATION, 'utf8').split(/^--\s*Down Migration\s*$/m);
  return up;
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'placeholder line-up slots',
  () => {
    let pool: Pool;
    const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-6);
    const teams = { home: randomUUID(), away: randomUUID() };
    const trialist = randomUUID();
    const unknown = randomUUID();
    const player = randomUUID();
    const fixtures: string[] = [];

    async function match(): Promise<{ id: string; home: string; away: string }> {
      const id = randomUUID();
      fixtures.push(id);
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status)
           VALUES ($1, $2, timestamptz '2025-07-12T14:00:00Z' + make_interval(days => $3), 'finished')`,
        [id, PL_2025, fixtures.length],
      );
      const { rows } = await pool.query<{ id: string; side: 'home' | 'away' }>(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
           VALUES ($1, $2, 'home'), ($1, $3, 'away') RETURNING id, side`,
        [id, teams.home, teams.away],
      );
      const of = (side: string) => rows.find((r) => r.side === side)?.id ?? '';
      return { id, home: of('home'), away: of('away') };
    }

    async function listed(fixtureId: string): Promise<{ side: string; person_id: string }[]> {
      const { rows } = await pool.query<{ side: string; person_id: string }>(
        `SELECT fp.side, l.person_id FROM lineup l
           JOIN fixture_participant fp ON fp.id = l.participant_id
          WHERE fp.fixture_id = $1 ORDER BY fp.side, l.shirt_number`,
        [fixtureId],
      );
      return rows;
    }

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      for (const [key, id] of Object.entries(teams)) {
        await pool.query(
          `INSERT INTO team (id, country_id, name, kind, gender) VALUES ($1, $2, $3, 'club', 'men')`,
          [id, ENGLAND, `T-1707 ${key} ${RUN}`],
        );
      }
      await pool.query(
        `INSERT INTO person (id, full_name) VALUES ($1, 'Trialist'), ($2, ' Unknown  Player '), ($3, $4)`,
        [trialist, unknown, player, `T-1707 player ${RUN}`],
      );
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
      await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [
        [trialist, unknown, player],
      ]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(teams)]);
      await pool.end();
    });

    it('writes no line-up row for the label, on either side, and keeps the real player', async () => {
      const m = await match();
      const resolver: RefResolver = {
        resolve: (ref) =>
          Promise.resolve(
            ref.externalId === '4242'
              ? { kind: 'resolved', internalId: trialist }
              : ref.externalId === '11'
                ? { kind: 'resolved', internalId: player }
                : { kind: 'queued' },
          ),
        link: () => Promise.resolve({ kind: 'linked' }),
      };
      const store = new IngestStore(pool, resolver);
      const side = (shirt: number, withPlayer: boolean) => ({
        formation: null,
        coach: null,
        kitColour: null,
        players: [
          {
            externalId: '4242',
            name: 'Trialist',
            role: 'starter',
            shirtNumber: shirt,
            position: null,
            isCaptain: false,
            grid: null,
          },
          ...(withPlayer
            ? [
                {
                  externalId: '11',
                  name: 'Real Player',
                  role: 'starter',
                  shirtNumber: 9,
                  position: null,
                  isCaptain: false,
                  grid: null,
                },
              ]
            : []),
        ],
      });
      const lineup = {
        fixtureExternalId: 'x',
        home: side(19, true),
        away: side(30, false),
      } as unknown as NormalisedLineup;

      const write = await store.saveLineup('api_football', m.id, lineup);

      expect(write.unresolved).toEqual([]);
      expect(await listed(m.id)).toEqual([{ side: 'home', person_id: player }]);
    });

    it('the repair removes the placeholder rows stored before, and nothing else', async () => {
      const m = await match();
      await pool.query(
        `INSERT INTO lineup (participant_id, person_id, role, shirt_number)
           VALUES ($1, $3, 'starter', 19), ($1, $5, 'starter', 9),
                  ($2, $3, 'bench', 30), ($2, $4, 'bench', 31)`,
        [m.home, m.away, trialist, unknown, player],
      );
      await pool.query(
        `INSERT INTO fixture_player_stat (participant_id, person_id, metric, value)
           VALUES ($1, $3, 'minutes', 90), ($2, $3, 'minutes', 20), ($1, $4, 'minutes', 90)`,
        [m.home, m.away, trialist, player],
      );

      await pool.query(repairSql());

      expect(await listed(m.id)).toEqual([{ side: 'home', person_id: player }]);
      const { rows: stats } = await pool.query<{ person_id: string }>(
        `SELECT person_id FROM fixture_player_stat WHERE participant_id = ANY($1::uuid[])`,
        [[m.home, m.away]],
      );
      expect(stats).toEqual([{ person_id: player }]);
      // The people stay: other rows may name them.
      const { rowCount } = await pool.query(`SELECT 1 FROM person WHERE id = ANY($1::uuid[])`, [
        [trialist, unknown],
      ]);
      expect(rowCount).toBe(2);
    });
  },
);
