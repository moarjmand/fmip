import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { IngestStore, type RefResolver } from './ingest-store';

/**
 * The squads job's SQL against the real schema (T-1324): which clubs are due,
 * the day's count, the ask record, and the read-only person lookup.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

const NO_RESOLVER: RefResolver = {
  resolve: () => Promise.resolve({ kind: 'unresolved' }),
  link: () => Promise.resolve({ kind: 'linked' }),
};

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the squads store', () => {
  let pool: Pool;
  let store: IngestStore;
  const teams: string[] = [randomUUID(), randomUUID(), randomUUID()];
  // A national team (T-1332), mapped and playing in the season: never asked about.
  const national = randomUUID();
  const friendly = randomUUID();
  const person = randomUUID();
  const fixture = randomUUID();
  const ext = (n: string) => `t1324-${RUN}-${n}`;

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new IngestStore(pool, NO_RESOLVER);
    await pool.query(
      `INSERT INTO team (id, name, kind, gender)
       VALUES ($1, 'Squad A', 'club', 'men'), ($2, 'Squad B', 'club', 'men'),
              ($3, 'Squad C', 'club', 'men')`,
      teams,
    );
    await pool.query(
      `INSERT INTO team (id, name, kind, gender, country_id)
       SELECT $1, 'Squad National', 'national', 'men', id FROM country WHERE code = 'IRN'`,
      [national],
    );
    await pool.query(`INSERT INTO person (id, full_name) VALUES ($1, 'Squad Player')`, [person]);
    await pool.query(
      `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
       VALUES ($1, $2, $3, 'Matchday', now() + interval '2 days', 'scheduled')`,
      [fixture, PL_2025, REGULAR_SEASON],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [fixture, teams[0], teams[1]],
    );
    await pool.query(
      `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
       VALUES ($1, $2, $3, 'Matchday', now() + interval '3 days', 'scheduled')`,
      [friendly, PL_2025, REGULAR_SEASON],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [friendly, national, teams[0]],
    );
    // Team C is mapped but plays in no season asked about.
    await pool.query(
      `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
       VALUES ('api_football', 'team', $1, $4), ('api_football', 'team', $2, $5),
              ('api_football', 'team', $3, $6), ('api_football', 'person', $7, $8),
              ('api_football', 'team', $9, $10)`,
      [
        ext('a'),
        ext('b'),
        ext('c'),
        teams[0],
        teams[1],
        teams[2],
        ext('p'),
        person,
        ext('n'),
        national,
      ],
    );
  });

  afterAll(async () => {
    if (pool === undefined) return;
    await pool.query(`DELETE FROM provider_mapping WHERE external_id LIKE $1`, [`t1324-${RUN}-%`]);
    await pool.query(`DELETE FROM fixture_participant WHERE fixture_id = ANY($1::uuid[])`, [
      [fixture, friendly],
    ]);
    await pool.query(`DELETE FROM fixture WHERE id = ANY($1::uuid[])`, [[fixture, friendly]]);
    await pool.query(`DELETE FROM team_squad_fetch WHERE team_id = ANY($1::uuid[])`, [teams]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[...teams, national]]);
    await pool.query(`DELETE FROM person WHERE id = $1`, [person]);
    await pool.query(`DELETE FROM ingest_run WHERE scope = $1`, [`t1324-${RUN}`]);
    await pool.end();
  });

  const ours = (rows: { teamId: string }[]) =>
    rows.map((r) => r.teamId).filter((id) => teams.includes(id) || id === national);
  const due = async (askedBefore = new Date().toISOString()) =>
    ours(
      await store.squadsDue(
        'api_football',
        [PL_2025],
        new Date(Date.now() - 30 * 86_400_000).toISOString(),
        askedBefore,
        10_000,
      ),
    );

  it('finds the mapped clubs of the seasons asked about, and no other (no national team)', async () => {
    expect((await due()).sort()).toEqual([teams[0], teams[1]].sort());
  });

  it('leaves a club answered this month, retries an unanswered one a day later', async () => {
    const since = new Date(Date.now() - 60_000).toISOString();
    const before = await store.squadsAskedSince('api_football', since);
    await store.markSquadAsked('api_football', teams[0]!, true);
    await store.replaceSquadListing('api_football', teams[0]!, 25, []);
    await store.markSquadAsked('api_football', teams[1]!, false);
    expect(await store.squadsAskedSince('api_football', since)).toBe(before + 2);
    expect(await due(new Date(Date.now() - 86_400_000).toISOString())).toEqual([]);
    // A day on, the unanswered club is due again; the answered one is not.
    expect(await due(new Date(Date.now() + 60_000).toISOString())).toEqual([teams[1]]);
  });

  it('owes a club answered before listings were recorded its listing now (T-1632)', async () => {
    // Answered this month, but by the job that kept only photos: no `listed`.
    await pool.query(
      `UPDATE team_squad_fetch SET answered_at = now() - interval '3 days',
                                   asked_at = now() - interval '3 days', listed = NULL
        WHERE provider = 'api_football' AND team_id = $1`,
      [teams[0]],
    );
    await pool.query(
      `UPDATE team_squad_fetch SET answered_at = NULL, asked_at = now() - interval '3 days'
        WHERE provider = 'api_football' AND team_id = $1`,
      [teams[1]],
    );
    // Never answered first, then the club owed its listing.
    expect(await due()).toEqual([teams[1], teams[0]]);
    // Once its listing is recorded it waits for the month like any other.
    await store.replaceSquadListing('api_football', teams[0]!, 25, []);
    expect(await due()).toEqual([teams[1]]);
  });

  it('asks first for the club whose competition stands higher on the scores page (T-1632)', async () => {
    const competition = randomUUID();
    const season = randomUUID();
    const placed = randomUUID();
    await pool.query(
      `INSERT INTO competition (id, name, kind, scope, gender, display_order)
       VALUES ($1, $2, 'cup', 'international', 'men', 30000)`,
      [competition, `Squad Order Cup ${RUN}`],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, '2099', '2099-01-01', '2099-12-31', false)`,
      [season, competition],
    );
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status)
       VALUES ($1, $2, '2099-06-01T15:00:00Z', 'scheduled')`,
      [placed, season],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side)
       VALUES ($1, $2, 'home'), ($1, $3, 'away')`,
      [placed, teams[2], national],
    );
    try {
      // Both owed their listing, the unplaced club's answer the older one.
      await pool.query(
        `INSERT INTO team_squad_fetch (provider, team_id, asked_at, answered_at)
         VALUES ('api_football', $1, now() - interval '3 days', now() - interval '3 days')
         ON CONFLICT (provider, team_id) DO UPDATE
           SET asked_at = EXCLUDED.asked_at, answered_at = EXCLUDED.answered_at, listed = NULL`,
        [teams[2]],
      );
      await pool.query(
        `UPDATE team_squad_fetch SET answered_at = now() - interval '9 days',
                                     asked_at = now() - interval '9 days', listed = NULL
          WHERE provider = 'api_football' AND team_id = $1`,
        [teams[0]],
      );
      const order = ours(
        await store.squadsDue(
          'api_football',
          [PL_2025, season],
          new Date(Date.now() - 30 * 86_400_000).toISOString(),
          new Date().toISOString(),
          10_000,
        ),
      );
      expect(order.filter((id) => id !== teams[1])).toEqual([teams[2], teams[0]]);
    } finally {
      await pool.query(`DELETE FROM fixture_participant WHERE fixture_id = $1`, [placed]);
      await pool.query(`DELETE FROM fixture WHERE id = $1`, [placed]);
      await pool.query(`DELETE FROM season WHERE id = $1`, [season]);
      await pool.query(`DELETE FROM competition WHERE id = $1`, [competition]);
    }
  });

  it('reads only persons already mapped, and creates none', async () => {
    const held = await store.mappedPersons('api_football', [ext('p'), ext('unknown')]);
    expect([...held]).toEqual([[ext('p'), person]]);
    const { rows } = await pool.query(`SELECT 1 FROM provider_mapping WHERE external_id = $1`, [
      ext('unknown'),
    ]);
    expect(rows).toEqual([]);
  });

  it('replaces a club’s listed squad as a whole, and records the listing’s size (T-1428)', async () => {
    const listing = async () =>
      (
        await pool.query<{
          person_id: string;
          shirt_number: number | null;
          position: string | null;
        }>(`SELECT person_id, shirt_number, position FROM team_squad_member WHERE team_id = $1`, [
          teams[0],
        ])
      ).rows;
    await store.markSquadAsked('api_football', teams[0]!, true);
    await store.replaceSquadListing('api_football', teams[0]!, 28, [
      { personId: person, shirtNumber: 7, position: 'forward' },
    ]);
    expect(await listing()).toEqual([{ person_id: person, shirt_number: 7, position: 'forward' }]);
    const fetched = await pool.query<{ listed: number }>(
      `SELECT listed FROM team_squad_fetch WHERE team_id = $1`,
      [teams[0]],
    );
    expect(fetched.rows[0]?.listed).toBe(28);
    // The next listing leaves him out: he is no longer in the squad.
    await store.replaceSquadListing('api_football', teams[0]!, 27, []);
    expect(await listing()).toEqual([]);
  });

  it('records a squads run in ingest_run', async () => {
    await pool.query(
      `INSERT INTO ingest_run (provider, job, scope, status, finished_at, requests)
       VALUES ('api_football', 'squads', $1, 'succeeded', now(), 2)`,
      [`t1324-${RUN}`],
    );
  });
});
