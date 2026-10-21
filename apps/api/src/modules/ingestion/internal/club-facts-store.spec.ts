import { randomUUID } from 'node:crypto';
import type { NormalisedFixture, NormalisedTeamFacts, NormalisedVenueFacts } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ClubFactsStore } from './club-facts-store';
import { IngestStore, type PollTarget, type RefResolver } from './ingest-store';

/**
 * The club-and-ground pass's SQL on a database (T-1438, D-229): which
 * seasons and grounds are owed an ask, what a season's teams write -- a
 * club's founding year and home ground, the ground's facts, never a national
 * team's, never an id nobody mapped -- and the referee written as plain name
 * text by the fixture writer.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const PROVIDER = 'api_football' as const;
const LATER = '2999-01-01T00:00:00Z';
const EARLIER = '2000-01-01T00:00:00Z';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'the club and ground facts store',
  () => {
    let pool: Pool;
    let store: ClubFactsStore;
    const id = {
      league: randomUUID(),
      current: randomUUID(),
      past: randomUUID(),
      empty: randomUUID(),
      club: randomUUID(),
      other: randomUUID(),
      nation: randomUUID(),
      ground: randomUUID(),
      neutral: randomUUID(),
      fixture: randomUUID(),
    };
    const ext = (n: string) => `t1438-${RUN}-${n}`;
    const seasons: string[] = [id.current, id.past, id.empty];
    const venues: string[] = [id.ground, id.neutral];
    const at = (over: Partial<Record<'answeredBeforeIso' | 'retryBeforeIso', string>> = {}) => ({
      answeredBeforeIso: EARLIER,
      retryBeforeIso: EARLIER,
      ...over,
    });
    const seasonsDue = async (over = {}, maxFailures = 5) =>
      (await store.seasonsDue(PROVIDER, at(over), maxFailures, 50_000)).filter((a) =>
        seasons.includes(a.seasonId),
      );
    const venuesDue = async (over = {}, maxFailures = 5) =>
      (await store.venuesDue(PROVIDER, at(over), maxFailures, 50_000)).filter((a) =>
        venues.includes(a.venueId),
      );

    function ground(over: Partial<NormalisedVenueFacts> = {}): NormalisedVenueFacts {
      return {
        externalId: ext('ground'),
        name: 'Provider Ground Name',
        city: 'Manchester',
        address: 'Sir Matt Busby Way',
        capacity: 76212,
        surface: 'grass',
        imageUrl: 'https://media.api-sports.io/football/venues/556.png',
        ...over,
      };
    }
    function entry(team: string, over: Partial<NormalisedTeamFacts> = {}): NormalisedTeamFacts {
      return {
        team: { externalId: ext(team), name: team },
        national: false,
        foundedYear: 1878,
        venue: ground(),
        ...over,
      };
    }
    const club = async (teamId: string) =>
      (
        await pool.query<{ founded_year: number | null; home_venue_id: string | null }>(
          `SELECT founded_year, home_venue_id FROM team WHERE id = $1`,
          [teamId],
        )
      ).rows[0];
    const venueRow = async (venueId: string) =>
      (
        await pool.query(
          `SELECT name, city, address, capacity, surface, latitude, longitude
             FROM venue WHERE id = $1`,
          [venueId],
        )
      ).rows[0];

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      store = new ClubFactsStore(pool);
      await pool.query(
        `INSERT INTO competition (id, name, kind, scope, gender)
         VALUES ($1, 'T-1438 League', 'league', 'international', 'men')`,
        [id.league],
      );
      await pool.query(
        `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current) VALUES
           ($1, $4, '2026/27', '2026-08-01', '2027-05-31', true),
           ($2, $4, '2021/22', '2021-08-01', '2022-05-31', false),
           ($3, $4, '2019/20', '2019-08-01', '2020-05-31', false)`,
        [id.current, id.past, id.empty, id.league],
      );
      // A code of three letters no other row holds.
      await pool.query(
        `INSERT INTO country (id, name, code)
         SELECT $1, $2, x.code
           FROM (SELECT 'Z' || chr(65 + a) || chr(65 + b) AS code
                   FROM generate_series(0, 25) a, generate_series(0, 25) b) x
          WHERE NOT EXISTS (SELECT 1 FROM country c WHERE c.code = x.code)
          ORDER BY random() LIMIT 1`,
        [id.nation, `T-1438 Nation ${RUN}`],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender, country_id) VALUES
           ($1, 'T-1438 Club', 'club', 'men', NULL),
           ($2, 'T-1438 Other', 'club', 'men', NULL),
           ($3, 'T-1438 Nation', 'national', 'men', $3)`,
        [id.club, id.other, id.nation],
      );
      await pool.query(
        `INSERT INTO venue (id, name, city) VALUES ($1, 'Old Trafford', NULL), ($2, 'Neutral', 'Wembley')`,
        venues,
      );
      const mappings: [string, string, string][] = [
        ['competition', ext('league'), id.league],
        ['team', ext('club'), id.club],
        ['team', ext('other'), id.other],
        ['team', ext('nation'), id.nation],
        ['venue', ext('ground'), id.ground],
        ['venue', ext('neutral'), id.neutral],
      ];
      for (const [type, external, internal] of mappings) {
        await pool.query(
          `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
           VALUES ('api_football', $1, $2, $3)`,
          [type, external, internal],
        );
      }
      // One match in each of the two seasons asked about; the third has none.
      await pool.query(
        `INSERT INTO fixture (id, season_id, kickoff_at, status, venue_id) VALUES
           ($1, $2, '2026-10-01T18:00:00Z', 'finished', $3),
           (gen_random_uuid(), $4, '2021-10-01T18:00:00Z', 'finished', NULL)`,
        [id.fixture, id.current, id.neutral, id.past],
      );
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await pool.query(`DELETE FROM fixture WHERE season_id = ANY($1::uuid[])`, [seasons]);
      await pool.query(`DELETE FROM provider_mapping WHERE external_id LIKE $1`, [
        `t1438-${RUN}-%`,
      ]);
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [
        [id.club, id.other, id.nation],
      ]);
      await pool.query(`DELETE FROM venue WHERE id = ANY($1::uuid[])`, [venues]);
      await pool.query(`DELETE FROM country WHERE id = $1`, [id.nation]);
      await pool.query(`DELETE FROM season WHERE id = ANY($1::uuid[])`, [seasons]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [id.league]);
      await pool.end();
    });

    it('owes an ask to each season of a mapped competition that holds a match, current first', async () => {
      expect(await seasonsDue()).toEqual([
        { seasonId: id.current, competitionExternalId: ext('league'), seasonLabel: '2026/27' },
        { seasonId: id.past, competitionExternalId: ext('league'), seasonLabel: '2021/22' },
      ]);
    });

    it("writes a club's founding year and home ground and the ground's facts, and nothing else", async () => {
      const kept = await store.saveSeasonTeams(PROVIDER, id.current, [
        entry('club'),
        // A national team's "home ground" and "founded" are its federation's.
        entry('nation', { national: true, foundedYear: 1895, venue: ground() }),
        // A team we do not hold.
        entry('stranger'),
        // A club whose ground no mapping knows: counted, not created.
        entry('other', { foundedYear: null, venue: ground({ externalId: ext('unknown') }) }),
      ]);
      expect(kept).toEqual({
        held: 3,
        clubsWritten: 1,
        venuesWritten: 1,
        unmappedVenues: 1,
        images: [
          {
            entityType: 'venue',
            entityId: id.ground,
            url: 'https://media.api-sports.io/football/venues/556.png',
          },
        ],
      });
      expect(await club(id.club)).toEqual({ founded_year: 1878, home_venue_id: id.ground });
      expect(await club(id.other)).toEqual({ founded_year: null, home_venue_id: null });
      expect(await club(id.nation)).toEqual({ founded_year: null, home_venue_id: null });
      // The catalogue's name stands; a city fills only where none is stored;
      // no coordinates are invented.
      expect(await venueRow(id.ground)).toEqual({
        name: 'Old Trafford',
        city: 'Manchester',
        address: 'Sir Matt Busby Way',
        capacity: 76212,
        surface: 'grass',
        latitude: null,
        longitude: null,
      });
      // The current season is answered, and the ground counts as described.
      expect((await seasonsDue()).map((a) => a.seasonId)).toEqual([id.past]);
      expect((await venuesDue()).map((a) => a.venueId)).toEqual([id.neutral]);
    });

    it('writes nothing the second time, and keeps a fact an answer leaves out', async () => {
      const again = await store.saveSeasonTeams(PROVIDER, id.current, [
        entry('club', { foundedYear: null, venue: ground({ capacity: null, address: null }) }),
      ]);
      expect(again).toMatchObject({ held: 1, clubsWritten: 0, venuesWritten: 0 });
      expect(await club(id.club)).toEqual({ founded_year: 1878, home_venue_id: id.ground });
      expect(await venueRow(id.ground)).toMatchObject({
        capacity: 76212,
        address: 'Sir Matt Busby Way',
      });
      // A renovated ground's new capacity replaces the old one.
      await store.saveSeasonTeams(PROVIDER, id.current, [
        entry('club', { venue: ground({ capacity: 74310 }) }),
      ]);
      expect(await venueRow(id.ground)).toMatchObject({ capacity: 74310 });
    });

    it('asks the current season again after the refresh, a past season never', async () => {
      await store.saveSeasonTeams(PROVIDER, id.past, []);
      expect(await seasonsDue()).toEqual([]);
      expect((await seasonsDue({ answeredBeforeIso: LATER })).map((a) => a.seasonId)).toEqual([
        id.current,
      ]);
    });

    it('describes a ground asked by id, records one the provider has no entry for, and retries a failure', async () => {
      expect(await venuesDue()).toEqual([{ venueId: id.neutral, externalId: ext('neutral') }]);
      await store.markVenueFailed(PROVIDER, id.neutral);
      expect(await venuesDue()).toEqual([]);
      expect(await venuesDue({ retryBeforeIso: LATER })).toHaveLength(1);
      expect(await venuesDue({ retryBeforeIso: LATER }, 1)).toEqual([]);

      expect(
        await store.saveVenue(
          PROVIDER,
          id.neutral,
          ground({ externalId: ext('neutral'), surface: 'hybrid', city: 'London', address: null }),
        ),
      ).toBe(true);
      expect(await venueRow(id.neutral)).toMatchObject({
        city: 'Wembley',
        capacity: 76212,
        surface: 'hybrid',
        address: null,
      });
      expect(await store.saveVenue(PROVIDER, id.neutral, null)).toBe(false);
      const { rows } = await pool.query(
        `SELECT failures, answered_by FROM venue_detail_fetch WHERE venue_id = $1`,
        [id.neutral],
      );
      expect(rows).toEqual([{ failures: 0, answered_by: 'none' }]);
      expect(await venuesDue()).toEqual([]);
      expect(await venuesDue({ answeredBeforeIso: LATER })).toHaveLength(2);
    });

    it('refuses a surface word that is not ours', async () => {
      await expect(
        pool.query(`UPDATE venue SET surface = 'sand' WHERE id = $1`, [id.ground]),
      ).rejects.toThrow(/venue_surface_check/);
    });

    describe('the referee (T-1438)', () => {
      const target: PollTarget = {
        competitionId: id.league,
        competitionExternalId: ext('league'),
        seasonId: id.current,
        seasonLabel: '2026/27',
        seasonStart: '2026-08-01',
        seasonEnd: '2027-05-31',
      };
      const teams: RefResolver = {
        resolve: (ref) =>
          Promise.resolve(
            ref.entityType === 'team' && ref.externalId === 'h'
              ? { kind: 'resolved', internalId: id.club }
              : ref.entityType === 'team' && ref.externalId === 'a'
                ? { kind: 'resolved', internalId: id.other }
                : { kind: 'unresolved' },
          ),
        link: () => Promise.resolve({ kind: 'linked' }),
      };
      const match = (referee: string | null): NormalisedFixture =>
        ({
          externalId: ext('match'),
          competition: { externalId: ext('league'), name: 'League' },
          season: { label: '2026/27' },
          stage: null,
          round: null,
          kickoffAt: '2026-11-01T15:00:00Z',
          status: 'scheduled',
          minute: null,
          home: { externalId: 'h', name: 'Home' },
          away: { externalId: 'a', name: 'Away' },
          venue: null,
          referee: referee === null ? null : { externalId: null, name: referee },
          scores: {
            current: null,
            halfTime: null,
            fullTime: null,
            extraTime: null,
            penalties: null,
            aggregate: null,
          },
        }) as unknown as NormalisedFixture;
      const stored = async (fixtureId: string) =>
        (
          await pool.query(`SELECT referee_name, referee_id FROM fixture WHERE id = $1`, [
            fixtureId,
          ])
        ).rows[0];

      it('is written as the name, kept when an answer names nobody, and never an id', async () => {
        const ingest = new IngestStore(pool, teams);
        const first = await ingest.saveFixture(PROVIDER, target, match(null), 'fixtures');
        const fixtureId = first.fixtureId!;
        await pool.query(
          `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
           VALUES ('api_football', 'fixture', $1, $2)`,
          [ext('match'), fixtureId],
        );
        expect(await stored(fixtureId)).toEqual({ referee_name: null, referee_id: null });

        const named = await ingest.saveFixture(
          PROVIDER,
          target,
          match('Anthony Taylor'),
          'fixtures',
        );
        expect(named.changed).toBe(1);
        expect(await stored(fixtureId)).toEqual({
          referee_name: 'Anthony Taylor',
          referee_id: null,
        });

        const silent = await ingest.saveFixture(PROVIDER, target, match(null), 'fixtures');
        expect(silent.changed).toBe(0);
        expect(await stored(fixtureId)).toEqual({
          referee_name: 'Anthony Taylor',
          referee_id: null,
        });

        await ingest.saveFixture(PROVIDER, target, match('Michael Oliver'), 'fixtures');
        expect(await stored(fixtureId)).toEqual({
          referee_name: 'Michael Oliver',
          referee_id: null,
        });
      });
    });
  },
);
