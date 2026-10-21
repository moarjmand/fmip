import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PlayerTransfers, TeamTransfers } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from './catalog.module';
import { transfersCoverage } from './internal/transfers';

/**
 * `GET /teams/:id/transfers` and `GET /players/:id/transfers` (T-1440, D-231)
 * against the real schema: nothing until the provider was asked, arrivals and
 * departures with our clubs and players linked and the rest as the provider's
 * names, `delayed` once an answer is behind, and a player's moves from the
 * clubs' answers, once each, as `limited` before he is asked about himself.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe('transfersCoverage (T-1440)', () => {
  const now = new Date('2026-10-21T12:00:00Z');
  it('is not supplied until answered with a move, delayed once twice the refresh old', () => {
    expect(transfersCoverage(null, 0, now)).toBe('not_supplied');
    expect(transfersCoverage(now, 0, now)).toBe('not_supplied');
    expect(transfersCoverage(new Date('2026-09-01T12:00:00Z'), 3, now)).toBe('available');
    // Outside a window the refresh is a month: sixty days behind is late.
    expect(transfersCoverage(new Date('2026-08-21T11:00:00Z'), 3, now)).toBe('delayed');
    // In a window it is a week.
    const july = new Date('2026-07-21T12:00:00Z');
    expect(transfersCoverage(new Date('2026-07-01T12:00:00Z'), 3, july)).toBe('delayed');
  });
});

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'transfers on the club and player pages (T-1440)',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    const id = {
      club: randomUUID(),
      rival: randomUUID(),
      empty: randomUUID(),
      stale: randomUUID(),
      never: randomUUID(),
      held: randomUUID(),
      asked: randomUUID(),
      nothing: randomUUID(),
    };
    const teams = [id.club, id.rival, id.empty, id.stale, id.never];
    const people = [id.held, id.asked, id.nothing];

    const get = <T>(url: string) =>
      app.inject({ method: 'GET', url }).then((r) => ({ status: r.statusCode, body: r.json<T>() }));

    /** One stored move in a subject's answer. */
    const listing = (
      subject: { team?: string; person?: string },
      move: {
        person?: string | null;
        name: string;
        date: string;
        kind: string;
        fee?: string | null;
        from?: [string | null, string] | null;
        to?: [string | null, string] | null;
      },
    ) =>
      pool.query(
        `INSERT INTO transfer_listing
           (source, subject_team_id, subject_person_id, person_id, person_name, transfer_date,
            kind, fee, from_team_id, from_name, to_team_id, to_name, fetched_at)
         VALUES ('api_football', $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())`,
        [
          subject.team ?? null,
          subject.person ?? null,
          move.person ?? null,
          move.name,
          move.date,
          move.kind,
          move.fee ?? null,
          move.from?.[0] ?? null,
          move.from?.[1] ?? null,
          move.to?.[0] ?? null,
          move.to?.[1] ?? null,
        ],
      );

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, CatalogModule],
      }).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = new Pool({ connectionString: DATABASE_URL });

      await pool.query(
        `INSERT INTO team (id, name, short_name, kind, gender) VALUES
           ($1, 'T-1440 Club', 'Club', 'club', 'men'), ($2, 'T-1440 Rival', NULL, 'club', 'men'),
           ($3, 'T-1440 Empty', NULL, 'club', 'men'), ($4, 'T-1440 Stale', NULL, 'club', 'men'),
           ($5, 'T-1440 Never', NULL, 'club', 'men')`,
        teams,
      );
      await pool.query(
        `INSERT INTO person (id, full_name, known_as) VALUES
           ($1, 'Held Player', 'H. Player'), ($2, 'Asked Player', NULL), ($3, 'Nothing Player', NULL)`,
        people,
      );
      await pool.query(
        `INSERT INTO team_transfer_fetch (provider, team_id, answered_at, moves, players_held) VALUES
           ('api_football', $1, now(), 3, 1), ('api_football', $2, now(), 1, 1),
           ('api_football', $3, now(), 0, 0), ('api_football', $4, now() - interval '100 days', 1, 0)`,
        [id.club, id.rival, id.empty, id.stale],
      );
      await pool.query(
        `INSERT INTO person_transfer_fetch (provider, person_id, answered_at, moves)
         VALUES ('api_football', $1, now(), 2)`,
        [id.asked],
      );
      // The club's answer: the held player arrives from the rival, a stranger
      // leaves on loan for a club we do not hold, and a fee.
      await listing(
        { team: id.club },
        {
          person: id.held,
          name: 'Provider Name',
          date: '2025-07-01',
          kind: 'fee',
          fee: '€ 75M',
          from: [id.rival, 'Provider Rival'],
          to: [id.club, 'Provider Club'],
        },
      );
      await listing(
        { team: id.club },
        {
          name: 'B. Stranger',
          date: '2026-01-31',
          kind: 'loan',
          from: [id.club, 'Provider Club'],
          to: [null, 'Internazionale'],
        },
      );
      await listing(
        { team: id.club },
        {
          person: id.held,
          name: 'Provider Name',
          date: '2026-06-30',
          kind: 'free',
          from: [id.club, 'Provider Club'],
          to: null,
        },
      );
      // The rival's answer lists the same move once more.
      await listing(
        { team: id.rival },
        {
          person: id.held,
          name: 'Provider Name',
          date: '2025-07-01',
          kind: 'fee',
          fee: '€ 75M',
          from: [id.rival, 'Provider Rival'],
          to: [id.club, 'Provider Club'],
        },
      );
      await listing(
        { team: id.stale },
        {
          name: 'C. Old',
          date: '2020-07-01',
          kind: 'transfer',
          from: [null, 'Somewhere'],
          to: [id.stale, 'Stale'],
        },
      );
      // The asked player's own answer, with a move between clubs we do not hold.
      await listing(
        { person: id.asked },
        {
          person: id.asked,
          name: 'A. Asked',
          date: '2019-01-01',
          kind: 'unknown',
          from: [null, 'Molde'],
          to: [null, 'Red Bull Salzburg'],
        },
      );
      await listing(
        { person: id.asked },
        {
          person: id.asked,
          name: 'A. Asked',
          date: '2022-07-01',
          kind: 'loan_return',
          from: [null, 'Red Bull Salzburg'],
          to: [id.club, 'Provider Club'],
        },
      );
    });

    afterAll(async () => {
      if (pool !== undefined) {
        await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [people]);
        await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
        await pool.end();
      }
      if (app !== undefined) await app.close();
    });

    it('answers 404 for no such club or player', async () => {
      expect((await get(`/teams/${randomUUID()}/transfers`)).status).toBe(404);
      expect((await get('/teams/not-a-uuid/transfers')).status).toBe(404);
      expect((await get(`/players/${randomUUID()}/transfers`)).status).toBe(404);
    });

    it('says nothing is supplied before a club is asked about, and when it lists no move', async () => {
      const never = await get<TeamTransfers>(`/teams/${id.never}/transfers`);
      expect(never.body).toEqual({
        source_name: 'API-Football',
        transfers: { coverage: 'not_supplied', last_updated_at: null, data: null },
      });
      const empty = await get<TeamTransfers>(`/teams/${id.empty}/transfers`);
      expect(empty.body.transfers.coverage).toBe('not_supplied');
      expect(empty.body.transfers.last_updated_at).not.toBeNull();
      expect(empty.body.transfers.data).toBeNull();
    });

    it('lists arrivals and departures, ours linked by our names, the rest as the provider wrote them', async () => {
      const { status, body } = await get<TeamTransfers>(`/teams/${id.club}/transfers`);
      expect(status).toBe(200);
      expect(body.transfers.coverage).toBe('available');
      expect(body.transfers.data).toEqual({
        arrivals: [
          {
            date: '2025-07-01',
            kind: 'fee',
            fee: '€ 75M',
            player: { id: id.held, name: 'H. Player' },
            from: { id: id.rival, name: 'T-1440 Rival' },
            to: { id: id.club, name: 'Club' },
          },
        ],
        departures: [
          {
            date: '2026-06-30',
            kind: 'free',
            fee: null,
            player: { id: id.held, name: 'H. Player' },
            from: { id: id.club, name: 'Club' },
            to: null,
          },
          {
            date: '2026-01-31',
            kind: 'loan',
            fee: null,
            player: { id: null, name: 'B. Stranger' },
            from: { id: id.club, name: 'Club' },
            to: { id: null, name: 'Internazionale' },
          },
        ],
        arrivals_total: 1,
        departures_total: 2,
      });
    });

    it('marks an answer the job has left behind as delayed', async () => {
      const { body } = await get<TeamTransfers>(`/teams/${id.stale}/transfers`);
      expect(body.transfers.coverage).toBe('delayed');
      expect(body.transfers.data?.arrivals).toHaveLength(1);
    });

    it("reads a player asked about from the provider's own list, every move", async () => {
      const { body } = await get<PlayerTransfers>(`/players/${id.asked}/transfers`);
      expect(body.transfers.coverage).toBe('available');
      expect(
        body.transfers.data?.lines.map((l) => [l.date, l.kind, l.from?.name, l.to?.name]),
      ).toEqual([
        ['2022-07-01', 'loan_return', 'Red Bull Salzburg', 'Club'],
        ['2019-01-01', 'unknown', 'Molde', 'Red Bull Salzburg'],
      ]);
    });

    it("reads a player not yet asked about from the clubs' answers, each move once, as limited", async () => {
      const { body } = await get<PlayerTransfers>(`/players/${id.held}/transfers`);
      expect(body.transfers.coverage).toBe('limited');
      expect(body.transfers.data?.lines.map((l) => [l.date, l.kind])).toEqual([
        ['2026-06-30', 'free'],
        ['2025-07-01', 'fee'],
      ]);
      const nothing = await get<PlayerTransfers>(`/players/${id.nothing}/transfers`);
      expect(nothing.body.transfers).toEqual({
        coverage: 'not_supplied',
        last_updated_at: null,
        data: null,
      });
    });
  },
);
