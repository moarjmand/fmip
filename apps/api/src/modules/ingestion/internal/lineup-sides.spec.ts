import { randomUUID } from 'node:crypto';
import type { NormalisedLineup, NormalisedLineupPlayer } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IngestStore, type RefResolver } from './ingest-store';

/**
 * Line-ups filed under the other team (T-1628, D-294). API-Football's archive
 * put Spain's players in France's block and France's in Spain's for the
 * Nations League semi-final of 5 June 2025 (provider fixture 1366137), and
 * Mbappé's page counted a match "for Spain". `align_lineup_sides` decides from
 * our own records -- each player's other line-ups, a national team's
 * nationality, then the match's own minutes -- and the ingest store calls it
 * after each line-up and player-statistics write.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const PL_2025 = '00000000-0000-4000-8000-000000000302';
const ENGLAND_TEAM = '00000000-0000-4000-8000-000000000606';
const IRAN_TEAM = '00000000-0000-4000-8000-000000000607';
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const IRAN = '00000000-0000-4000-8000-000000000109';

interface Sides {
  home: string;
  away: string;
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'line-ups filed under the other team',
  () => {
    let pool: Pool;
    const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-6);
    const teams = { a: randomUUID(), b: randomUUID(), c: randomUUID() };
    const fixtures: string[] = [];
    const people = new Map<string, string>();
    let kickoff = 0;

    /** One person per key, made once: `a1` plays for club A, `e1` is English. */
    function person(key: string): string {
      const id = people.get(key);
      if (id === undefined) throw new Error(`no person ${key}`);
      return id;
    }

    async function match(home: string, away: string): Promise<{ id: string } & Sides> {
      const id = randomUUID();
      fixtures.push(id);
      kickoff += 1;
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status)
           VALUES ($1, $2, timestamptz '2025-08-01T18:00:00Z' + make_interval(days => $3), 'scheduled')`,
        [id, PL_2025, kickoff],
      );
      const { rows } = await pool.query<{ id: string; side: 'home' | 'away' }>(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
           VALUES ($1, $2, 'home'), ($1, $3, 'away') RETURNING id, side`,
        [id, home, away],
      );
      const of = (side: string) => rows.find((r) => r.side === side)?.id ?? '';
      return { id, home: of('home'), away: of('away') };
    }

    /** Lists `keys` on a side, shirts 1, 2, ... and a place in the shape for each. */
    async function list(participant: string, keys: string[], captain = false): Promise<void> {
      for (const [index, key] of keys.entries()) {
        await pool.query(
          `INSERT INTO lineup (participant_id, person_id, role, shirt_number, is_captain, grid_row, grid_col)
             VALUES ($1, $2, 'starter', $3, $4, 2, $3)`,
          [participant, person(key), index + 1, captain && index === 0],
        );
      }
    }

    async function minutes(participant: string, keys: string[]): Promise<void> {
      for (const key of keys) {
        await pool.query(
          `INSERT INTO fixture_player_stat (participant_id, person_id, metric, value)
             VALUES ($1, $2, 'minutes', 90)`,
          [participant, person(key)],
        );
      }
    }

    async function listed(participant: string): Promise<string[]> {
      const { rows } = await pool.query<{ person_id: string }>(
        `SELECT person_id FROM lineup WHERE participant_id = $1 ORDER BY shirt_number`,
        [participant],
      );
      return rows.map((r) => r.person_id);
    }

    async function align(fixtureId: string) {
      const { rows } = await pool.query<{
        turned: number;
        lineup_rows: number;
        stat_rows: number;
        substitutions: number;
      }>(`SELECT * FROM align_lineup_sides(ARRAY[$1::uuid])`, [fixtureId]);
      return rows[0];
    }

    const ids = (keys: string[]) => keys.map(person);
    const A = ['a1', 'a2', 'a3', 'a4', 'a5'];
    const B = ['b1', 'b2', 'b3', 'b4', 'b5'];

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      for (const [key, id] of Object.entries(teams)) {
        await pool.query(
          `INSERT INTO team (id, country_id, name, kind, gender) VALUES ($1, $2, $3, 'club', 'men')`,
          [id, ENGLAND, `T-1628 club ${key} ${RUN}`],
        );
      }
      const nationality: Record<string, string | null> = { a: null, b: null, e: ENGLAND, i: IRAN };
      for (const group of ['a', 'b', 'e', 'i']) {
        for (let n = 1; n <= 5; n += 1) {
          const id = randomUUID();
          people.set(`${group}${n}`, id);
          await pool.query(
            `INSERT INTO person (id, full_name, nationality_id) VALUES ($1, $2, $3)`,
            [id, `T-1628 ${group}${n} ${RUN}`, nationality[group]],
          );
        }
      }
      // Their other matches: club A's and club B's players each with their club.
      for (const [club, keys] of [
        [teams.a, A],
        [teams.b, B],
      ] as const) {
        for (let n = 0; n < 2; n += 1) {
          const other = await match(club, teams.c);
          await list(other.home, keys);
        }
      }
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
      await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [[...people.values()]]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(teams)]);
      await pool.end();
    });

    it("exchanges two line-ups that each name the other side's players", async () => {
      const m = await match(teams.a, teams.b);
      await list(m.home, B, true);
      await list(m.away, A);
      // The answer's substitution followed its line-ups; the goal did not.
      await pool.query(
        `INSERT INTO incident (fixture_id, participant_id, person_id, related_person_id, kind, minute, sequence)
           VALUES ($1, $2, $3, $4, 'substitution', 60, 1),
                  ($1, $5, $6, NULL, 'goal', 70, 2)`,
        [m.id, m.home, person('b2'), person('b5'), m.away, person('b3')],
      );

      expect(await align(m.id)).toEqual({
        turned: 1,
        lineup_rows: 10,
        stat_rows: 0,
        substitutions: 1,
      });

      expect(await listed(m.home)).toEqual(ids(A));
      expect(await listed(m.away)).toEqual(ids(B));
      const { rows } = await pool.query<{ shape: number; captains: number }>(
        `SELECT count(*) FILTER (WHERE grid_row IS NOT NULL)::int AS shape,
                count(*) FILTER (WHERE is_captain)::int AS captains
           FROM lineup WHERE participant_id = ANY($1::uuid[])`,
        [[m.home, m.away]],
      );
      // A place in the other team's shape, and its captain, are not his.
      expect(rows[0]).toEqual({ shape: 0, captains: 0 });
      const { rows: incidents } = await pool.query<{ kind: string; participant_id: string }>(
        `SELECT kind, participant_id FROM incident WHERE fixture_id = $1 ORDER BY sequence`,
        [m.id],
      );
      expect(incidents).toEqual([
        { kind: 'substitution', participant_id: m.away },
        { kind: 'goal', participant_id: m.away },
      ]);

      // Done once: a second pass finds nothing to move.
      expect(await align(m.id)).toEqual({
        turned: 0,
        lineup_rows: 0,
        stat_rows: 0,
        substitutions: 0,
      });
    });

    it('keeps line-ups that are right and moves the minutes the answer turned round', async () => {
      // Ecuador v Italy of 24 March 2024: the line-ups were right and the
      // per-player block was the one filed under the other team.
      const m = await match(teams.a, teams.b);
      await list(m.home, A);
      await list(m.away, B);
      await minutes(m.home, ['b1', 'b2', 'b3']);
      await minutes(m.away, ['a1', 'a2', 'a3']);

      expect(await align(m.id)).toMatchObject({ turned: 0, lineup_rows: 0, stat_rows: 6 });

      expect(await listed(m.home)).toEqual(ids(A));
      const { rows } = await pool.query<{ participant_id: string; person_id: string }>(
        `SELECT participant_id, person_id FROM fixture_player_stat
          WHERE participant_id = ANY($1::uuid[]) ORDER BY participant_id, person_id`,
        [[m.home, m.away]],
      );
      for (const row of rows) {
        expect(row.participant_id).toBe(ids(A).includes(row.person_id) ? m.home : m.away);
      }
    });

    it('reads nationality between national teams when no other line-up names the players', async () => {
      const m = await match(ENGLAND_TEAM, IRAN_TEAM);
      await list(m.home, ['i1', 'i2', 'i3', 'i4']);
      await list(m.away, ['e1', 'e2', 'e3', 'e4']);

      expect(await align(m.id)).toMatchObject({ turned: 1, lineup_rows: 8 });
      expect(await listed(m.home)).toEqual(ids(['e1', 'e2', 'e3', 'e4']));
    });

    it("moves a side whose opponent's list is empty", async () => {
      const m = await match(teams.a, teams.b);
      await list(m.away, ['a1', 'a2', 'a3']);

      expect(await align(m.id)).toMatchObject({ turned: 1, lineup_rows: 3 });
      expect(await listed(m.home)).toEqual(ids(['a1', 'a2', 'a3']));
      expect(await listed(m.away)).toEqual([]);
    });

    it('leaves a match alone when the evidence is mixed or thin', async () => {
      const mixed = await match(teams.a, teams.b);
      await list(mixed.home, ['b1', 'a1', 'a2']);
      await list(mixed.away, ['a3', 'b2', 'b3']);
      const thin = await match(teams.a, teams.b);
      await list(thin.home, ['b4']);
      await list(thin.away, ['a4']);

      for (const m of [mixed, thin]) {
        expect(await align(m.id)).toMatchObject({ turned: 0, lineup_rows: 0 });
      }
      expect(await listed(mixed.home)).toEqual(ids(['b1', 'a1', 'a2']));
      expect(await listed(thin.home)).toEqual(ids(['b4']));
    });

    it('moves the armband to the player the feed now names, and keeps one captain a side (T-1686)', async () => {
      const m = await match(teams.a, teams.b);
      const resolver: RefResolver = {
        resolve: (ref) => {
          const internalId = ref.entityType === 'person' ? people.get(ref.externalId) : undefined;
          return Promise.resolve(
            internalId === undefined ? { kind: 'unresolved' } : { kind: 'resolved', internalId },
          );
        },
        link: () => Promise.resolve({ kind: 'linked' }),
      };
      const store = new IngestStore(pool, resolver);
      const side = (keys: string[], captains: string[]) => ({
        formation: null,
        coach: null,
        kitColour: null,
        players: keys.map((key, index): NormalisedLineupPlayer => ({
          externalId: key,
          name: key,
          role: 'starter',
          shirtNumber: index + 1,
          position: null,
          isCaptain: captains.includes(key),
          grid: { row: 2, col: index + 1 },
        })),
      });
      const captainsOf = async (participant: string) => {
        const { rows } = await pool.query<{ person_id: string }>(
          `SELECT person_id FROM lineup WHERE participant_id = $1 AND is_captain`,
          [participant],
        );
        return rows.map((r) => r.person_id);
      };
      const answer = (captains: string[]): NormalisedLineup => ({
        fixtureExternalId: `t1686-${RUN}`,
        home: side(A, captains),
        away: side(B, []),
      });

      await store.saveLineup('api_football', m.id, answer(['a1']));
      expect(await captainsOf(m.home)).toEqual([person('a1')]);
      // The armband moves to a3: the write used to be refused by the one-captain index.
      await store.saveLineup('api_football', m.id, answer(['a3']));
      expect(await captainsOf(m.home)).toEqual([person('a3')]);
      // A feed naming two captains keeps the first it lists.
      await store.saveLineup('api_football', m.id, answer(['a2', 'a4']));
      expect(await captainsOf(m.home)).toEqual([person('a2')]);
    });

    it('puts a line-up the answer turned round back on its side as it is written', async () => {
      const m = await match(teams.a, teams.b);
      const resolver: RefResolver = {
        resolve: (ref) => {
          const internalId = ref.entityType === 'person' ? people.get(ref.externalId) : undefined;
          return Promise.resolve(
            internalId === undefined ? { kind: 'unresolved' } : { kind: 'resolved', internalId },
          );
        },
        link: () => Promise.resolve({ kind: 'linked' }),
      };
      const store = new IngestStore(pool, resolver);
      const players = (keys: string[]): NormalisedLineupPlayer[] =>
        keys.map((key, index) => ({
          externalId: key,
          name: key,
          role: 'starter',
          shirtNumber: index + 1,
          position: null,
          isCaptain: false,
          grid: { row: 2, col: index + 1 },
        }));
      const side = (keys: string[]) => ({
        formation: null,
        coach: null,
        kitColour: null,
        players: players(keys),
      });
      // The answer files club B's players under club A, and A's under B.
      const lineup: NormalisedLineup = {
        fixtureExternalId: `t1628-${RUN}`,
        home: side(B),
        away: side(A),
      };

      const write = await store.saveLineup('api_football', m.id, lineup);

      expect(write.unresolved).toEqual([]);
      expect(await listed(m.home)).toEqual(ids(A));
      expect(await listed(m.away)).toEqual(ids(B));

      // The same answer again ends the same way.
      await store.saveLineup('api_football', m.id, lineup);
      expect(await listed(m.home)).toEqual(ids(A));
      expect(await listed(m.away)).toEqual(ids(B));
    });
  },
);
