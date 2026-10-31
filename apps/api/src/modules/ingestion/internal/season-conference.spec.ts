import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { groupMembers } from './groups';
import { IngestStore, type RefResolver } from './ingest-store';

/**
 * T-1667 (D-319) against the real schema: the standings job writes each
 * club's conference from the provider's conference tables, and each run
 * that reads them leaves the season's rows exactly as they say. A temporary
 * league season with five clubs.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const LEAGUE = randomUUID();
const SEASON = randomUUID();
const TEAMS = {
  a: randomUUID(),
  b: randomUUID(),
  c: randomUUID(),
  d: randomUUID(),
  e: randomUUID(),
};

const NO_RESOLVER: RefResolver = {
  resolve: () => Promise.resolve({ kind: 'unresolved' }),
  link: () => Promise.resolve({ kind: 'linked' }),
};

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  "a season's conferences from the provider's tables",
  () => {
    let pool: Pool;
    let store: IngestStore;

    const held = async (): Promise<[string, string][]> => {
      const { rows } = await pool.query<{ team_id: string; name: string }>(
        `SELECT team_id, name FROM season_conference WHERE season_id = $1`,
        [SEASON],
      );
      const order: string[] = Object.values(TEAMS);
      return rows
        .map((r): [string, string] => [r.team_id, r.name])
        .sort((x, y) => order.indexOf(x[0]) - order.indexOf(y[0]));
    };

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      store = new IngestStore(pool, NO_RESOLVER);
      await pool.query(
        `INSERT INTO competition (id, name, kind, scope, gender)
         VALUES ($1, $2, 'league', 'international', 'men')`,
        [LEAGUE, `Conference League ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2088/89', DATE '2088-02-01', DATE '2088-11-30', true)`,
        [SEASON, LEAGUE],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES
           ($1, $6, 'club', 'men'), ($2, $7, 'club', 'men'), ($3, $8, 'club', 'men'),
           ($4, $9, 'club', 'men'), ($5, $10, 'club', 'men')`,
        [...Object.values(TEAMS), ...Object.keys(TEAMS).map((k) => `Conf ${k} ${RUN}`)],
      );
    });

    afterAll(async () => {
      if (pool === undefined) return;
      // The season's rows go with it (ON DELETE CASCADE).
      await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [LEAGUE]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(TEAMS)]);
      await pool.end();
    });

    const members = (tables: { group: string; teamIds: string[] }[]) =>
      groupMembers(tables).map((m) => ({ teamId: m.teamId, conference: m.group }));

    it("writes each club's conference, once", async () => {
      const both = members([
        { group: 'Eastern Conference', teamIds: [TEAMS.a, TEAMS.b] },
        { group: 'Western Conference', teamIds: [TEAMS.c, TEAMS.d] },
      ]);
      expect(await store.saveConferences(SEASON, both)).toBe(4);
      expect(await held()).toEqual([
        [TEAMS.a, 'Eastern Conference'],
        [TEAMS.b, 'Eastern Conference'],
        [TEAMS.c, 'Western Conference'],
        [TEAMS.d, 'Western Conference'],
      ]);
      // The next run changes nothing; a run that read no conferences writes nothing.
      expect(await store.saveConferences(SEASON, both)).toBe(0);
      expect(await store.saveConferences(SEASON, [])).toBe(0);
      expect(await held()).toHaveLength(4);
    });

    it('leaves the rows as the latest tables say: a club moved, added, gone, or in two', async () => {
      const next = members([
        // b moved west, e is new, d is listed in both (in neither), c is gone.
        { group: 'Eastern Conference', teamIds: [TEAMS.a, TEAMS.e, TEAMS.d] },
        { group: 'Western Conference', teamIds: [TEAMS.b, TEAMS.d] },
      ]);
      expect(await store.saveConferences(SEASON, next)).toBe(4);
      expect(await held()).toEqual([
        [TEAMS.a, 'Eastern Conference'],
        [TEAMS.b, 'Western Conference'],
        [TEAMS.e, 'Eastern Conference'],
      ]);
    });
  },
);
