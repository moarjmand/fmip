import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { StandingsService } from '../../standings/standings.service';
import { PostgresStandingsStore } from '../../standings/internal/standings-store';
import { groupMembers } from './groups';
import { IngestStore, type RefResolver } from './ingest-store';

/**
 * T-1399 against the real schema: Argentina's Liga Profesional. Two group
 * stages, the Apertura and the Clausura, each with a zone A and a zone B;
 * the zones play interzonal matches, which each zone's table counts for its
 * own team; the Apertura's knockout rounds are a stage of their own once an
 * operator adds it. Four teams: a and b in zone A of the Apertura, c and d in
 * zone B; the Clausura swaps b and c.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const LEAGUE = randomUUID();
const SEASON = randomUUID();
const APERTURA = randomUUID();
const CLAUSURA = randomUUID();
const ROUND_OF_16 = randomUUID();
const TEAMS = { a: randomUUID(), b: randomUUID(), c: randomUUID(), d: randomUUID() };
type Side = keyof typeof TEAMS;

const NO_RESOLVER: RefResolver = {
  resolve: () => Promise.resolve({ kind: 'unresolved' }),
  link: () => Promise.resolve({ kind: 'linked' }),
};

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  "Argentina's zone tables",
  () => {
    let pool: Pool;
    let store: IngestStore;
    let standings: StandingsService;
    const ids: Record<string, string> = {};
    let day = 1;

    async function fixture(
      name: string,
      stage: string,
      round: string,
      home: Side,
      away: Side,
      score: [number, number],
      status: 'finished' | 'awarded' = 'finished',
    ): Promise<void> {
      const id = randomUUID();
      ids[name] = id;
      await pool.query(
        `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
         VALUES ($1, $2, $3, $4, TIMESTAMPTZ '2088-02-01T15:00:00Z' + make_interval(days => $5), $6)`,
        [id, SEASON, stage, round, day++, status],
      );
      await pool.query(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
        [id, TEAMS[home], TEAMS[away]],
      );
      await pool.query(
        `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, 'full_time', $2, $3)`,
        [id, score[0], score[1]],
      );
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
         VALUES ($1, $2, 'league', 'international', 'men')`,
        [LEAGUE, `Zone League ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2088', DATE '2088-01-20', DATE '2088-12-20', true)`,
        [SEASON, LEAGUE],
      );
      await pool.query(
        `INSERT INTO stage (id, season_id, name, kind, sort_order, legs) VALUES
           ($1, $4, 'Apertura', 'group', 1, 1),
           ($2, $4, 'Apertura - Round of 16', 'knockout', 2, 1),
           ($3, $4, 'Clausura', 'group', 3, 1)`,
        [APERTURA, ROUND_OF_16, CLAUSURA, SEASON],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES
           ($1, $5, 'club', 'men'), ($2, $6, 'club', 'men'),
           ($3, $7, 'club', 'men'), ($4, $8, 'club', 'men')`,
        [...Object.values(TEAMS), ...Object.keys(TEAMS).map((k) => `Zone ${k} ${RUN}`)],
      );

      // Apertura: one match in each zone, one interzonal (a v c), one
      // awarded in zone B, and a knockout in its own stage.
      await fixture('ab', APERTURA, 'Apertura - 1', 'a', 'b', [2, 0]);
      await fixture('cd', APERTURA, 'Apertura - 1', 'c', 'd', [1, 1]);
      await fixture('ac', APERTURA, 'Apertura - 2', 'a', 'c', [0, 1]);
      await fixture('dc', APERTURA, 'Apertura - 3', 'd', 'c', [3, 0], 'awarded');
      await fixture('ko', ROUND_OF_16, 'Apertura - Round of 16', 'a', 'd', [4, 0]);
      // Clausura: zone A is a and c, zone B is b and d.
      await fixture('ca', CLAUSURA, 'Clausura - 1', 'c', 'a', [1, 0]);
      await fixture('bd', CLAUSURA, 'Clausura - 1', 'b', 'd', [0, 0]);
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await pool.query(`DELETE FROM fixture WHERE season_id = $1`, [SEASON]);
      await pool.query(`DELETE FROM stage WHERE season_id = $1`, [SEASON]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [LEAGUE]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(TEAMS)]);
      await pool.end();
    });

    it("keeps a knockout round in the operator's stage of it, named or not", async () => {
      // The adapter reads "Apertura" from "Apertura - Round of 16".
      expect(await store.stageId(SEASON, 'Apertura', 'Apertura - Round of 16')).toBe(ROUND_OF_16);
      expect(await store.stageId(SEASON, 'Apertura', 'Apertura - 7')).toBe(APERTURA);
      expect(await store.stageId(SEASON, 'Apertura', null)).toBe(APERTURA);
      expect(await store.stageId(SEASON, null, 'Apertura - Round of 16')).toBe(ROUND_OF_16);
      // A stage of another name never outranks the one the adapter named.
      expect(await store.stageId(SEASON, 'Clausura', 'Apertura - Round of 16')).toBe(CLAUSURA);
    });

    it("assigns each stage's zones from that stage's tables", async () => {
      const apertura = groupMembers([
        { group: 'A', teamIds: [TEAMS.a, TEAMS.b] },
        { group: 'B', teamIds: [TEAMS.c, TEAMS.d] },
      ]);
      const clausura = groupMembers([
        { group: 'A', teamIds: [TEAMS.a, TEAMS.c] },
        { group: 'B', teamIds: [TEAMS.b, TEAMS.d] },
      ]);
      expect(await store.assignGroups(SEASON, apertura, APERTURA)).toBe(3);
      expect(await store.assignGroups(SEASON, clausura, CLAUSURA)).toBe(2);

      expect(await groupOf('ab')).toBe('A');
      expect(await groupOf('cd')).toBe('B');
      expect(await groupOf('dc')).toBe('B');
      expect(await groupOf('ac')).toBeNull(); // interzonal: neither zone's
      expect(await groupOf('ko')).toBeNull();
      expect(await groupOf('ca')).toBe('A');
      expect(await groupOf('bd')).toBe('B');

      // Each stage's write leaves the other stage's groups as they are.
      expect(await store.assignGroups(SEASON, apertura, APERTURA)).toBe(0);
      expect(await store.assignGroups(SEASON, clausura, CLAUSURA)).toBe(0);
    });

    it('counts interzonal and awarded matches in each zone, and no knockout', async () => {
      const tables = await standings.groupTables(SEASON);
      expect(tables.map((t) => [t.stageId, t.name])).toEqual([
        [APERTURA, 'A'],
        [APERTURA, 'B'],
        [CLAUSURA, 'A'],
        [CLAUSURA, 'B'],
      ]);
      const rows = (i: number): [string, number, number][] =>
        tables[i]!.rows.map((r) => [r.team.id, r.played, r.points]);

      // a: beat b, lost to c (interzonal); the knockout is not counted.
      expect(rows(0)).toEqual([
        [TEAMS.a, 2, 3],
        [TEAMS.b, 1, 0],
      ]);
      // c: drew d, beat a (interzonal), lost the awarded match to d.
      expect(rows(1)).toEqual([
        [TEAMS.d, 2, 4],
        [TEAMS.c, 3, 4],
      ]);
      expect(tables[1]!.rows.map((r) => r.position)).toEqual([1, 2]);
      expect(rows(2)).toEqual([
        [TEAMS.c, 1, 3],
        [TEAMS.a, 1, 0],
      ]);
      expect(tables[1]!.counted).toBe(3);
    });

    it("gives the match centre's group line the same count", async () => {
      const before = await standings.tableBefore(SEASON, '2088-03-01T00:00:00Z', {
        stageId: APERTURA,
        name: 'B',
      });
      expect(before.counted).toBe(3);
      expect(before.table.data?.map((r) => [r.team.id, r.played])).toEqual([
        [TEAMS.d, 2],
        [TEAMS.c, 3],
      ]);
    });
  },
);
