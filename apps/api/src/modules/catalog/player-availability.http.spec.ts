import { randomUUID } from 'node:crypto';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import type { PlayerAvailability, PlayerPage } from '@fmip/contracts';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DatabaseModule } from '../../database/database.module';
import { CatalogModule } from './catalog.module';
import { availabilityOf } from './internal/player-store';

/**
 * The player page's current availability (T-1007, D-127) against the real
 * schema: the team's next scheduled match, and what the feed's absence list
 * says about the player for it -- nothing until the feed was asked, "not
 * listed" once it was and the player is absent from it, never "fit".
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const ENGLAND = '00000000-0000-4000-8000-000000000101';
const COMPETITION = randomUUID();
const SEASON = randomUUID();
const STAGE = randomUUID();
const TEAMS = { home: randomUUID(), away: randomUUID(), idle: randomUUID() };
const P = {
  listed: randomUUID(),
  absent: randomUUID(),
  lineupOnly: randomUUID(),
  idle: randomUUID(),
  nobody: randomUUID(),
};

describe('availabilityOf (T-1007)', () => {
  it('says nothing without a team, and never says fit', () => {
    expect(availabilityOf(null)).toEqual({
      team: null,
      fixture: null,
      listing: { coverage: 'not_supplied', last_updated_at: null, data: null },
      reason: 'no_team',
    });
  });
});

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'player availability (T-1007)',
  () => {
    let app: NestFastifyApplication;
    let pool: Pool;
    let next: string;
    let nextHome: string;

    const availability = async (id: string): Promise<PlayerAvailability> => {
      const res = await app.inject({ method: 'GET', url: `/players/${id}` });
      expect(res.statusCode).toBe(200);
      return res.json<PlayerPage>().availability;
    };

    async function fixture(kickoff: string, status: string): Promise<[string, string]> {
      const id = randomUUID();
      await pool.query(
        `INSERT INTO fixture (id, season_id, stage_id, kickoff_at, status)
         VALUES ($1, $2, $3, ${kickoff}, $4)`,
        [id, SEASON, STAGE, status],
      );
      const { rows } = await pool.query<{ id: string; side: string }>(
        `INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away') RETURNING id, side`,
        [id, TEAMS.home, TEAMS.away],
      );
      return [id, rows.find((r) => r.side === 'home')!.id];
    }

    beforeAll(async () => {
      const moduleRef = await Test.createTestingModule({
        imports: [DatabaseModule, CatalogModule],
      }).compile();
      app = moduleRef.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
      await app.init();
      await app.getHttpAdapter().getInstance().ready();
      pool = new Pool({ connectionString: DATABASE_URL });

      await pool.query(
        `INSERT INTO competition (id, country_id, name, kind, scope, gender)
         VALUES ($1, $2, $3, 'league', 'domestic', 'men')`,
        [COMPETITION, ENGLAND, `Availability League ${RUN}`],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
         VALUES ($1, $2, '2026/27', DATE '2026-08-01', DATE '2027-05-31', true)`,
        [SEASON, COMPETITION],
      );
      await pool.query(
        `INSERT INTO stage (id, season_id, name, kind, sort_order) VALUES ($1, $2, 'Regular season', 'league', 1)`,
        [STAGE, SEASON],
      );
      await pool.query(
        `INSERT INTO team (id, name, short_name, kind, gender) VALUES
           ($1, $4, 'HOM', 'club', 'men'), ($2, $5, 'AWY', 'club', 'men'), ($3, $6, NULL, 'club', 'men')`,
        [
          TEAMS.home,
          TEAMS.away,
          TEAMS.idle,
          `Avail Home ${RUN}`,
          `Avail Away ${RUN}`,
          `Avail Idle ${RUN}`,
        ],
      );
      await pool.query(
        `INSERT INTO person (id, full_name) VALUES
           ($1, 'Listed ${RUN}'), ($2, 'Absent ${RUN}'), ($3, 'Lineup ${RUN}'),
           ($4, 'Idle ${RUN}'), ($5, 'Nobody ${RUN}')`,
        [P.listed, P.absent, P.lineupOnly, P.idle, P.nobody],
      );
      await pool.query(
        `INSERT INTO player_spell (person_id, team_id, start_date) VALUES
           ($1, $4, DATE '2025-07-01'), ($2, $4, DATE '2025-07-01'), ($3, $5, DATE '2025-07-01')`,
        [P.listed, P.absent, P.idle, TEAMS.home, TEAMS.idle],
      );
      // A finished match that names the line-up-only player, then the next two ahead.
      const [, pastHome] = await fixture(`now() - interval '7 days'`, 'finished');
      await pool.query(
        `INSERT INTO lineup (participant_id, person_id, role) VALUES ($1, $2, 'starter')`,
        [pastHome, P.lineupOnly],
      );
      [next, nextHome] = await fixture(`now() + interval '3 days'`, 'scheduled');
      await fixture(`now() + interval '10 days'`, 'scheduled');
    });

    afterAll(async () => {
      await pool.query(`DELETE FROM fixture WHERE season_id = $1`, [SEASON]);
      await pool.query(`DELETE FROM player_spell WHERE person_id = ANY($1::uuid[])`, [
        Object.values(P),
      ]);
      await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [Object.values(P)]);
      await pool.query(`DELETE FROM stage WHERE id = $1`, [STAGE]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [SEASON]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [COMPETITION]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [Object.values(TEAMS)]);
      await pool.end();
      await app.close();
    });

    it('says nothing for a player with no team, or a team with no match ahead', async () => {
      expect((await availability(P.nobody)).reason).toBe('no_team');
      const idle = await availability(P.idle);
      expect(idle.reason).toBe('no_next_match');
      expect(idle.team).toMatchObject({ id: TEAMS.idle, basis: 'spell' });
      expect(idle.listing.coverage).toBe('not_supplied');
    });

    it('says nothing about the next match before the feed was asked about it', async () => {
      const a = await availability(P.absent);
      expect(a.reason).toBe('not_asked');
      expect(a.fixture).toMatchObject({
        id: next,
        opponent: { id: TEAMS.away, name: `Avail Away ${RUN}`, short_name: 'AWY' },
      });
      expect(a.listing).toEqual({ coverage: 'not_supplied', last_updated_at: null, data: null });
    });

    it('once asked: the listed player out with the reason, the absent one not listed', async () => {
      await pool.query(
        `INSERT INTO fixture_availability_fetch (fixture_id, provider) VALUES ($1, 'api_football')`,
        [next],
      );
      await pool.query(
        `INSERT INTO fixture_absence (fixture_id, participant_id, person_id, status, kind, reason)
         VALUES ($1, $2, $3, 'out', 'injury', 'Hamstring')`,
        [next, nextHome, P.listed],
      );
      const listed = await availability(P.listed);
      expect(listed.reason).toBeNull();
      expect(listed.listing.coverage).toBe('available');
      expect(listed.listing.last_updated_at).not.toBeNull();
      expect(listed.listing.data).toMatchObject({
        status: 'out',
        kind: 'injury',
        reason: 'Hamstring',
      });
      const absent = await availability(P.absent);
      expect(absent.listing.data).toEqual({
        status: 'not_listed',
        kind: null,
        reason: null,
        reported_at: null,
      });
    });

    it("reads the latest line-up's team for a player with no open spell", async () => {
      const a = await availability(P.lineupOnly);
      expect(a.team).toMatchObject({ id: TEAMS.home, basis: 'lineup' });
      expect(a.fixture?.id).toBe(next);
      expect(a.listing.data?.status).toBe('not_listed');
    });
  },
);
