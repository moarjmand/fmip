import { randomUUID } from 'node:crypto';
import type { NormalisedTransfer } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TransferStore } from './transfer-store';

/**
 * The `transfers` job's SQL on a database (T-1440, D-231): which clubs and
 * players are owed an ask, the replacing write that joins players and clubs
 * through `provider_mapping` only, and the ask records that pace the retries.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const PROVIDER = 'api_football' as const;
const LATER = '2999-01-01T00:00:00Z';
const EARLIER = '2000-01-01T00:00:00Z';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the transfers store', () => {
  let pool: Pool;
  let store: TransferStore;
  const id = {
    league: randomUUID(),
    season: randomUUID(),
    home: randomUUID(),
    away: randomUUID(),
    unmappedTeam: randomUUID(),
    starter: randomUUID(),
    unmappedPerson: randomUUID(),
    fixture: randomUUID(),
  };
  const ext = (n: string) => `t1440-${RUN}-${n}`;
  const teams: string[] = [id.home, id.away, id.unmappedTeam];
  const people: string[] = [id.starter, id.unmappedPerson];
  const at = (over: Partial<Record<'answeredBeforeIso' | 'retryBeforeIso', string>> = {}) => ({
    answeredBeforeIso: EARLIER,
    retryBeforeIso: EARLIER,
    ...over,
  });
  const dueTeams = async (over = {}, maxFailures = 5) =>
    (await store.due(PROVIDER, 'team', at(over), maxFailures, 50_000)).filter((a) =>
      teams.includes(a.id),
    );
  const duePeople = async (over = {}, maxFailures = 5) =>
    (await store.due(PROVIDER, 'person', at(over), maxFailures, 50_000)).filter((a) =>
      people.includes(a.id),
    );

  function move(over: Partial<NormalisedTransfer>): NormalisedTransfer {
    return {
      player: { externalId: ext('starter'), name: 'A. Starter' },
      date: '2025-07-01',
      kind: 'fee',
      fee: '€ 75M',
      from: { externalId: ext('away'), name: 'Provider Away' },
      to: { externalId: ext('home'), name: 'Provider Home' },
      ...over,
    };
  }

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new TransferStore(pool);
    await pool.query(
      `INSERT INTO competition (id, name, kind, scope, gender)
       VALUES ($1, 'T-1440 League', 'league', 'international', 'men')`,
      [id.league],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, '2026/27', '2026-08-01', '2027-05-31', true)`,
      [id.season, id.league],
    );
    await pool.query(
      `INSERT INTO team (id, name, kind, gender) VALUES
         ($1, 'T-1440 Home', 'club', 'men'), ($2, 'T-1440 Away', 'club', 'men'),
         ($3, 'T-1440 Unmapped', 'club', 'men')`,
      teams,
    );
    await pool.query(
      `INSERT INTO person (id, full_name) VALUES ($1, 'T-1440 Starter'), ($2, 'T-1440 Unmapped')`,
      people,
    );
    const mappings: [string, string, string][] = [
      ['team', ext('home'), id.home],
      ['team', ext('away'), id.away],
      ['person', ext('starter'), id.starter],
    ];
    for (const [type, external, internal] of mappings) {
      await pool.query(
        `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
         VALUES ('api_football', $1, $2, $3)`,
        [type, external, internal],
      );
    }
    await pool.query(
      `INSERT INTO fixture (id, season_id, kickoff_at, status)
       VALUES ($1, $2, now() - interval '2 days', 'finished')`,
      [id.fixture, id.season],
    );
    await pool.query(
      `WITH p AS (
         INSERT INTO fixture_participant (fixture_id, team_id, side)
         VALUES ($1, $2, 'home'), ($1, $3, 'away') RETURNING id, side)
       INSERT INTO lineup (participant_id, person_id, role)
       SELECT p.id, x.person, 'starter' FROM p
         JOIN (VALUES ('home', $4::uuid), ('away', $5::uuid)) AS x (side, person)
           ON x.side = p.side`,
      [id.fixture, id.home, id.away, id.starter, id.unmappedPerson],
    );
  });

  afterAll(async () => {
    if (pool === undefined) return;
    await pool.query(`DELETE FROM fixture WHERE id = $1`, [id.fixture]);
    await pool.query(`DELETE FROM provider_mapping WHERE external_id LIKE $1`, [`t1440-${RUN}-%`]);
    await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [people]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [teams]);
    await pool.query(`DELETE FROM season WHERE id = $1`, [id.season]);
    await pool.query(`DELETE FROM competition WHERE id = $1`, [id.league]);
    await pool.end();
  });

  it('owes an ask to each mapped club of a current season and each mapped player in its line-ups', async () => {
    expect((await dueTeams()).map((a) => [a.id, a.externalId]).sort()).toEqual(
      [
        [id.home, ext('home')],
        [id.away, ext('away')],
      ].sort(),
    );
    expect(await duePeople()).toEqual([
      { subject: 'person', id: id.starter, externalId: ext('starter') },
    ]);
  });

  it('joins players and clubs we hold, keeps the rest as names, and replaces on the next answer', async () => {
    const ask = { subject: 'team' as const, id: id.home, externalId: ext('home') };
    const written = await store.save(
      PROVIDER,
      ask,
      [
        move({}),
        move({
          player: { externalId: ext('stranger'), name: 'B. Stranger' },
          date: '2026-01-31',
          kind: 'loan',
          fee: null,
          from: { externalId: ext('home'), name: 'Provider Home' },
          to: { externalId: null, name: 'Internazionale' },
        }),
        move({
          date: '2026-06-30',
          kind: 'free',
          fee: null,
          from: { externalId: ext('home'), name: 'Provider Home' },
          to: null,
        }),
      ],
      '2026-10-21T00:00:00Z',
    );
    expect(written).toBe(3);
    const rows = await pool.query(
      `SELECT person_id, person_name, transfer_date::text AS date, kind, fee,
              from_team_id, from_name, to_team_id, to_name
         FROM transfer_listing WHERE subject_team_id = $1 ORDER BY transfer_date`,
      [id.home],
    );
    expect(rows.rows).toEqual([
      {
        person_id: id.starter,
        person_name: 'A. Starter',
        date: '2025-07-01',
        kind: 'fee',
        fee: '€ 75M',
        from_team_id: id.away,
        from_name: 'Provider Away',
        to_team_id: id.home,
        to_name: 'Provider Home',
      },
      {
        person_id: null,
        person_name: 'B. Stranger',
        date: '2026-01-31',
        kind: 'loan',
        fee: null,
        from_team_id: id.home,
        from_name: 'Provider Home',
        to_team_id: null,
        to_name: 'Internazionale',
      },
      {
        person_id: id.starter,
        person_name: 'A. Starter',
        date: '2026-06-30',
        kind: 'free',
        fee: null,
        from_team_id: id.home,
        from_name: 'Provider Home',
        to_team_id: null,
        to_name: null,
      },
    ]);
    const fetch = await pool.query(
      `SELECT failures, moves, players_held FROM team_transfer_fetch WHERE team_id = $1`,
      [id.home],
    );
    expect(fetch.rows).toEqual([{ failures: 0, moves: 3, players_held: 2 }]);

    // The next answer replaces this club's moves, and no other subject's.
    await store.save(
      PROVIDER,
      { subject: 'person', id: id.starter, externalId: ext('starter') },
      [move({})],
      '2026-10-21T00:00:00Z',
    );
    await store.save(PROVIDER, ask, [move({})], '2026-10-22T00:00:00Z');
    const counts = await pool.query<{ team: number; person: number }>(
      `SELECT count(*) FILTER (WHERE subject_team_id = $1)::int AS team,
              count(*) FILTER (WHERE subject_person_id = $2)::int AS person
         FROM transfer_listing`,
      [id.home, id.starter],
    );
    expect(counts.rows[0]).toEqual({ team: 1, person: 1 });
  });

  it('asks again once the answer is older than the refresh, and paces unanswered asks', async () => {
    // Answered above: not due until the answer is older than the refresh.
    expect((await dueTeams()).map((a) => a.id)).toEqual([id.away]);
    expect((await dueTeams({ answeredBeforeIso: LATER })).map((a) => a.id).sort()).toEqual(
      [id.home, id.away].sort(),
    );
    expect(await duePeople()).toEqual([]);

    const away = { subject: 'team' as const, id: id.away, externalId: ext('away') };
    await store.markAsked(PROVIDER, away);
    // Just asked: not again before the retry time, and not after the last failure allowed.
    expect((await dueTeams()).map((a) => a.id)).toEqual([]);
    expect((await dueTeams({ retryBeforeIso: LATER })).map((a) => a.id)).toEqual([id.away]);
    expect(await dueTeams({ retryBeforeIso: LATER }, 1)).toEqual([]);
    await store.save(PROVIDER, away, [], '2026-10-21T00:00:00Z');
    const fetch = await pool.query(
      `SELECT failures, moves FROM team_transfer_fetch WHERE team_id = $1`,
      [id.away],
    );
    expect(fetch.rows).toEqual([{ failures: 0, moves: 0 }]);
  });
});
