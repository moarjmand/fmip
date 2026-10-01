import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StandingsService } from '../../standings/standings.service';
import { PostgresStandingsStore } from '../../standings/internal/standings-store';
import { groupMembers } from './groups';
import { IngestStore, type RefResolver } from './ingest-store';

/**
 * T-1333 against the real schema: the standings job writes each group-stage
 * fixture's group from the provider's group tables, and our group tables are
 * then built from those fixtures. A temporary cup with a group stage and a
 * knockout round; five teams, four of them in the provider's two groups.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const CUP = randomUUID();
const SEASON = randomUUID();
const GROUPS = randomUUID();
const FINAL = randomUUID();
const TEAMS = {
  a: randomUUID(),
  b: randomUUID(),
  c: randomUUID(),
  d: randomUUID(),
  e: randomUUID(),
};
type Side = keyof typeof TEAMS;

const NO_RESOLVER: RefResolver = {
  resolve: () => Promise.resolve({ kind: 'unresolved' }),
  link: () => Promise.resolve({ kind: 'linked' }),
};

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'group-stage fixtures take their group from the provider tables',
  () => {
    let pool: Pool;
    let store: IngestStore;
    let standings: StandingsService;
    const ids: Record<string, string> = {};

    async function fixture(
      name: string,
      stage: string,
      home: Side,
      away: Side,
      group: string | null,
      score: [number, number] | null,
    ): Promise<void> {
      const id = randomUUID();
      ids[name] = id;
      await pool.query(
        `INSERT INTO fixture (id, season_id, stage_id, round, group_name, kickoff_at, status)
         VALUES ($1, $2, $3, 'Round', $4, TIMESTAMPTZ '2088-09-01T15:00:00Z', $5)`,
        [id, SEASON, stage, group, score === null ? 'scheduled' : 'finished'],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, TEAMS[home], TEAMS[away]],
      );
      if (score !== null) {
        await pool.query(
          `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', $2, $3)`,
          [id, score[0], score[1]],
        );
      }
    }

    const groupOf = async (name: string): Promise<string | null> => {
      const { rows } = await pool.query<{ group_name: string | null }>(
        `SELECT group_name FROM fixture WHERE id = $1`,
        [ids[name]],
      );
      return rows[0]?.group_name ?? null;
    };

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      store = new IngestStore(pool, NO_RESOLVER);
      standings = new StandingsService(new PostgresStandingsStore(pool));

      await pool.query(
        `INSERT INTO competition (id, name, kind, scope, gender)
         VALUES ($1, $2, 'cup', 'international', 'men')`,
        [CUP, `Group Cup ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2088/89', DATE '2088-08-01', DATE '2089-06-30', true)`,
        [SEASON, CUP],
      );
      await pool.query(
        `INSERT INTO stage (id, season_id, name, kind, sort_order, legs) VALUES
           ($1, $3, 'League A', 'group', 1, 1),
           ($2, $3, 'Final', 'knockout', 2, 1)`,
        [GROUPS, FINAL, SEASON],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES
           ($1, $6, 'club', 'men'), ($2, $7, 'club', 'men'), ($3, $8, 'club', 'men'),
           ($4, $9, 'club', 'men'), ($5, $10, 'club', 'men')`,
        [...Object.values(TEAMS), ...Object.keys(TEAMS).map((k) => `Grp ${k} ${RUN}`)],
      );

      await fixture('ab', GROUPS, 'a', 'b', null, [2, 0]);
      await fixture('cd', GROUPS, 'c', 'd', null, null);
      // Written once as group 1, but the tables put its teams in two groups.
      await fixture('ac', GROUPS, 'a', 'c', '1', null);
      // e is in no table the provider sent: nothing says its group.
      await fixture('ae', GROUPS, 'a', 'e', null, null);
      // Two teams of one group meeting in a knockout round: no group.
      await fixture('final', FINAL, 'a', 'b', null, null);
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [Object.values(ids)]);
      await pool.query(`DELETE FROM stage WHERE season_id = $1`, [SEASON]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [CUP]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(TEAMS)]);
      await pool.end();
    });

    it('writes the group both teams share, and only from evidence', async () => {
      const members = groupMembers([
        { group: '1', teamIds: [TEAMS.a, TEAMS.b] },
        { group: '2', teamIds: [TEAMS.c, TEAMS.d] },
      ]);
      expect(await store.assignGroups(SEASON, members)).toBe(3);

      expect(await groupOf('ab')).toBe('1');
      expect(await groupOf('cd')).toBe('2');
      expect(await groupOf('ac')).toBeNull();
      expect(await groupOf('ae')).toBeNull();
      expect(await groupOf('final')).toBeNull();

      // The next run changes nothing.
      expect(await store.assignGroups(SEASON, members)).toBe(0);
      expect(await store.assignGroups(SEASON, [])).toBe(0);
    });

    it('ranks each group of the season on its own', async () => {
      const tables = await standings.groupTables(SEASON);
      expect(tables.map((t) => [t.stageId, t.name])).toEqual([
        [GROUPS, '1'],
        [GROUPS, '2'],
      ]);
      const [one, two] = tables;
      expect(one?.rows.map((r) => [r.team.id, r.played, r.points])).toEqual([
        [TEAMS.a, 1, 3],
        [TEAMS.b, 1, 0],
      ]);
      expect(two?.rows.map((r) => r.played)).toEqual([0, 0]);
    });
  },
);
