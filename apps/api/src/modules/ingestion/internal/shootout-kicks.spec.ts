import { randomUUID } from 'node:crypto';
import type { NormalisedIncident } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IngestStore, type RefResolver } from './ingest-store';

/**
 * A penalty shoot-out's kicks marked on the incident (T-1673, D-322). Rows
 * stored before the mark are read once by `mark_shootout_kicks` (the
 * migration's backfill, the web's `shootoutStart`: T-1477, D-318); the
 * ingestion writes the feed's own mark and never takes it back from the same
 * incident.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const PL_2025 = '00000000-0000-4000-8000-000000000302';
const ENGLAND = '00000000-0000-4000-8000-000000000101';

type Kind = 'goal' | 'own_goal' | 'penalty_goal' | 'penalty_missed' | 'yellow_card' | 'substitution';
/** sequence, kind, side, minute, added time */
type Row = [number, Kind, 'home' | 'away', number, number | null];

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  "a shoot-out's kicks marked on the incident",
  () => {
    let pool: Pool;
    const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-6);
    const teams = { a: randomUUID(), b: randomUUID() };
    const taker = randomUUID();
    const fixtures: string[] = [];
    let kickoff = 0;

    async function match(
      scores: Record<string, [number, number]>,
      rows: Row[],
    ): Promise<{ id: string; home: string; away: string }> {
      const id = randomUUID();
      fixtures.push(id);
      kickoff += 1;
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status)
           VALUES ($1, $2, timestamptz '2025-08-01T18:00:00Z' + make_interval(days => $3), 'finished')`,
        [id, PL_2025, kickoff],
      );
      const { rows: sides } = await pool.query<{ id: string; side: 'home' | 'away' }>(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
           VALUES ($1, $2, 'home'), ($1, $3, 'away') RETURNING id, side`,
        [id, teams.a, teams.b],
      );
      const of = (side: string) => sides.find((r) => r.side === side)?.id ?? '';
      for (const [kind, [home, away]] of Object.entries(scores)) {
        await pool.query(
          `INSERT INTO fixture_score (fixture_id, kind, home, away) VALUES ($1, $2, $3, $4)`,
          [id, kind, home, away],
        );
      }
      for (const [sequence, kind, side, minute, added] of rows) {
        await pool.query(
          `INSERT INTO incident (fixture_id, participant_id, person_id, related_person_id, kind,
                                 minute, added_time, sequence)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [id, of(side), taker, kind === 'substitution' ? taker : null, kind, minute, added, sequence],
        );
      }
      return { id, home: of('home'), away: of('away') };
    }

    async function marked(fixtureId: string): Promise<number[]> {
      const { rows } = await pool.query<{ sequence: number }>(
        `SELECT sequence FROM incident WHERE fixture_id = $1 AND in_shootout ORDER BY sequence`,
        [fixtureId],
      );
      return rows.map((r) => r.sequence);
    }

    async function mark(fixtureId: string): Promise<number> {
      const { rows } = await pool.query<{ n: number }>(
        `SELECT mark_shootout_kicks(ARRAY[$1::uuid]) AS n`,
        [fixtureId],
      );
      return rows[0]!.n;
    }

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      for (const [key, id] of Object.entries(teams)) {
        await pool.query(
          `INSERT INTO team (id, country_id, name, kind, gender) VALUES ($1, $2, $3, 'club', 'men')`,
          [id, ENGLAND, `T-1673 club ${key} ${RUN}`],
        );
      }
      await pool.query(`INSERT INTO person (id, full_name) VALUES ($1, $2)`, [
        taker,
        `T-1673 taker ${RUN}`,
      ]);
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [fixtures]);
      await pool.query(`DELETE FROM person WHERE id = $1`, [taker]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(teams)]);
      await pool.end();
    });

    it('marks an exact shoot-out and keeps an in-play penalty at 120+1 in play', async () => {
      // 1-1 after ninety, 2-2 after extra time, the equaliser a penalty at
      // 120+1 just before the kicks; Alpha win the shoot-out 3-1.
      const m = await match(
        { full_time: [1, 1], extra_time: [1, 1], current: [2, 2], penalties: [3, 1] },
        [
          [1, 'goal', 'home', 30, null],
          [2, 'goal', 'away', 50, null],
          [3, 'goal', 'away', 100, null],
          [4, 'penalty_goal', 'home', 120, 1],
          [5, 'penalty_goal', 'home', 120, 1],
          [6, 'penalty_missed', 'away', 120, 2],
          [7, 'penalty_goal', 'home', 120, 3],
          [8, 'penalty_goal', 'away', 120, 4],
          [9, 'penalty_goal', 'home', 120, 5],
        ],
      );
      expect(await mark(m.id)).toBe(5);
      expect(await marked(m.id)).toEqual([5, 6, 7, 8, 9]);
      // Read again, nothing new: the statement can run twice.
      expect(await mark(m.id)).toBe(0);
    });

    it('reads a shoot-out with a kick missing from the score after play (Manresa, D-318)', async () => {
      // Manresa v Sant Andreu (27 Oct 2026) as production holds it: 2-2
      // after extra time, 1-4 on penalties, one of Sant Andreu's four scored
      // kicks absent; two bookings at 120+1 and 120+2 before the kicks.
      const m = await match(
        { full_time: [0, 0], extra_time: [2, 2], current: [2, 2], penalties: [1, 4] },
        [
          [1, 'substitution', 'away', 24, null],
          [12, 'goal', 'away', 93, null],
          [15, 'goal', 'away', 105, null],
          [16, 'yellow_card', 'away', 114, null],
          [17, 'penalty_goal', 'home', 116, null],
          [18, 'goal', 'home', 119, null],
          [19, 'yellow_card', 'home', 120, 1],
          [20, 'yellow_card', 'away', 120, 2],
          [21, 'penalty_missed', 'home', 120, 1],
          [22, 'penalty_goal', 'away', 120, 2],
          [23, 'penalty_missed', 'home', 120, 2],
          [24, 'penalty_goal', 'away', 120, 3],
          [25, 'penalty_goal', 'home', 120, 3],
          [26, 'penalty_goal', 'away', 120, 4],
        ],
      );
      expect(await mark(m.id)).toBe(6);
      expect(await marked(m.id)).toEqual([21, 22, 23, 24, 25, 26]);
    });

    it('starts a short shoot-out after an in-play penalty at 120+1', async () => {
      // 2-2 after extra time with the equaliser at 120+1; 3-2 on penalties,
      // one of Beta's scored kicks absent, so no run adds up.
      const m = await match(
        { full_time: [1, 1], current: [2, 2], penalties: [3, 2] },
        [
          [1, 'goal', 'home', 30, null],
          [2, 'goal', 'away', 50, null],
          [3, 'goal', 'away', 100, null],
          [4, 'penalty_goal', 'home', 120, 1],
          [5, 'penalty_goal', 'home', 120, 1],
          [6, 'penalty_missed', 'away', 120, 2],
          [7, 'penalty_goal', 'home', 120, 3],
          [8, 'penalty_goal', 'away', 120, 4],
          [9, 'penalty_goal', 'home', 120, 5],
        ],
      );
      expect(await mark(m.id)).toBe(5);
      expect(await marked(m.id)).toEqual([5, 6, 7, 8, 9]);
    });

    it('marks nothing where two scored kicks are missing, or where no shoot-out was played', async () => {
      // 1-1, 5-3 on penalties, three of Alpha's five scored kicks recorded.
      const short = await match(
        { full_time: [1, 1], current: [1, 1], penalties: [5, 3] },
        [
          [1, 'goal', 'home', 30, null],
          [2, 'goal', 'away', 50, null],
          [3, 'penalty_goal', 'home', 120, 1],
          [4, 'penalty_goal', 'away', 120, 2],
          [5, 'penalty_goal', 'home', 120, 3],
          [6, 'penalty_goal', 'away', 120, 4],
          [7, 'penalty_goal', 'home', 120, 5],
          [8, 'penalty_goal', 'away', 120, 6],
        ],
      );
      // A league match won by a penalty at 90+5: no shoot-out score, untouched.
      const league = await match({ full_time: [1, 0], current: [1, 0] }, [
        [1, 'penalty_goal', 'home', 90, 5],
      ]);
      // Extra time won by a penalty at 120+1, nothing on penalties.
      const extra = await match({ full_time: [0, 0], current: [1, 0] }, [
        [1, 'penalty_goal', 'home', 120, 1],
      ]);
      for (const m of [short, league, extra]) {
        expect(await mark(m.id)).toBe(0);
        expect(await marked(m.id)).toEqual([]);
      }
    });

    it('leaves a match the feed has already marked to the feed', async () => {
      const m = await match(
        { full_time: [0, 0], current: [0, 0], penalties: [1, 0] },
        [
          [1, 'penalty_missed', 'away', 120, 1],
          [2, 'penalty_goal', 'home', 120, 2],
        ],
      );
      await pool.query(
        `UPDATE incident SET in_shootout = true WHERE fixture_id = $1 AND sequence = 2`,
        [m.id],
      );
      expect(await mark(m.id)).toBe(0);
      expect(await marked(m.id)).toEqual([2]);
    });

    it("writes the feed's mark and keeps it when an answer repeats the kick without it", async () => {
      const m = await match({ full_time: [0, 0], current: [0, 0], penalties: [1, 0] }, []);
      const resolver: RefResolver = {
        resolve: () => Promise.resolve({ kind: 'resolved', internalId: taker }),
        link: () => Promise.resolve({ kind: 'linked' }),
      };
      const store = new IngestStore(pool, resolver);
      const kick = (
        sequence: number,
        kind: NormalisedIncident['kind'],
        side: 'home' | 'away',
        inShootout: boolean,
      ): NormalisedIncident => ({
        fixtureExternalId: 'x',
        sequence,
        minute: 120,
        addedTime: sequence,
        kind,
        side,
        player: { externalId: '7', name: 'Taker' },
        relatedPlayer: null,
        detail: null,
        inShootout,
      });

      await store.saveIncidents('api_football', m.id, [
        kick(1, 'penalty_missed', 'away', true),
        kick(2, 'penalty_goal', 'home', true),
      ]);
      expect(await marked(m.id)).toEqual([1, 2]);

      // The same incidents without the mark: nothing written, the mark stays.
      const again = await store.saveIncidents('api_football', m.id, [
        kick(1, 'penalty_missed', 'away', false),
        kick(2, 'penalty_goal', 'home', false),
      ]);
      expect(again.changed).toBe(0);
      expect(await marked(m.id)).toEqual([1, 2]);

      // A different incident at place 2 takes the answer's mark.
      await store.saveIncidents('api_football', m.id, [
        kick(1, 'penalty_missed', 'away', false),
        { ...kick(2, 'penalty_goal', 'away', false), minute: 119, addedTime: null },
      ]);
      expect(await marked(m.id)).toEqual([1]);
    });
  },
);
