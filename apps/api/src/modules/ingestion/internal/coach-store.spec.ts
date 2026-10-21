import { randomUUID } from 'node:crypto';
import type { NormalisedCoach } from '@fmip/ingestion';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CoachStore } from './coach-store';
import type { MediaSink, RefResolver } from './ingest-store';
import { readCoachPage, readTeamHeadCoach } from '../../catalog/internal/coach-read';

/**
 * The `coaches` job's SQL and the coach read side on a database (T-1439,
 * D-230): which teams are owed an ask, the answer's writes (a coach we do not
 * hold queued, a team we do not carry counted, only empty bio fields filled),
 * putting back a moved-out coach reference once its coach is adopted, and the
 * head coach and coach page read from what was written.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const PROVIDER = 'api_football' as const;
const LATER = '2999-01-01T00:00:00Z';
const EARLIER = '2000-01-01T00:00:00Z';
/** A trigram no seeded country has: Q, then two letters from the run. */
const CODE = `Q${[...RUN]
  .map((c) => String.fromCharCode(65 + (c.charCodeAt(0) % 26)))
  .join('')
  .slice(-2)}`;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the coaches store', () => {
  let pool: Pool;
  let store: CoachStore;
  const queued: string[] = [];
  const noted: [string, string][] = [];
  const id = {
    league: randomUUID(),
    season: randomUUID(),
    city: randomUUID(),
    chelsea: randomUUID(),
    guardiola: randomUUID(),
    maresca: randomUUID(),
    player: randomUUID(),
    fixture: randomUUID(),
    home: randomUUID(),
    away: randomUUID(),
    country: randomUUID(),
  };
  const ext = (n: string) => `t1439-${RUN}-${n}`;
  const coachExt = (n: string) => `coach:t1439-${RUN}-${n}`;

  const resolver: RefResolver = {
    async resolve(ref, payload) {
      const { rows } = await pool.query<{ internal_id: string }>(
        `SELECT internal_id FROM provider_mapping
          WHERE provider = $1 AND entity_type = $2 AND external_id = $3`,
        [ref.provider, ref.entityType, ref.externalId],
      );
      if (rows[0] !== undefined) return { kind: 'resolved', internalId: rows[0].internal_id };
      queued.push(`${ref.externalId} ${JSON.stringify(payload)}`);
      return { kind: 'queued' };
    },
    link: () => Promise.reject(new Error('not used')),
  } as RefResolver;
  const media: MediaSink = {
    note: async (_p, _t, entityId, url) => void noted.push([entityId, url]),
  };

  const teamsDue = async (at = { answeredBeforeIso: EARLIER, retryBeforeIso: EARLIER }) =>
    (await store.teamsDue(PROVIDER, at, 5, 50_000)).filter((t) =>
      ([id.city, id.chelsea] as string[]).includes(t.teamId),
    );

  const maresca = (over: Partial<NormalisedCoach> = {}): NormalisedCoach => ({
    ref: {
      externalId: coachExt('maresca'),
      name: 'E. Maresca',
      imageUrl: 'https://media/12629.png',
    },
    name: { fullName: 'Vincenzo Maresca', givenName: 'Vincenzo', familyName: 'Maresca' },
    dateOfBirth: '1980-02-10',
    nationality: { name: `T-1439 Land ${RUN}`, code: null },
    career: [
      { team: { externalId: ext('city'), name: 'City' }, start: '2026-08-01', end: null },
      { team: { externalId: ext('chelsea'), name: 'Chelsea' }, start: '2024-06-01', end: null },
      { team: { externalId: ext('parma'), name: 'Parma' }, start: '2021-05-01', end: '2021-11-01' },
    ],
    ...over,
  });
  const guardiola: NormalisedCoach = {
    ref: { externalId: coachExt('guardiola'), name: 'Guardiola' },
    name: null,
    dateOfBirth: null,
    nationality: null,
    career: [{ team: { externalId: ext('city'), name: 'City' }, start: '2016-07-01', end: null }],
  };

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new CoachStore(pool, resolver, media);
    await pool.query(`INSERT INTO country (id, name, code) VALUES ($1, $2, $3)`, [
      id.country,
      `T-1439 Land ${RUN}`,
      CODE,
    ]);
    await pool.query(
      `INSERT INTO competition (id, name, kind, scope, gender)
       VALUES ($1, 'T-1439 League', 'league', 'international', 'men')`,
      [id.league],
    );
    await pool.query(
      `INSERT INTO season (id, competition_id, label, start_date, end_date, is_current)
       VALUES ($1, $2, '2026/27', '2026-08-01', '2027-05-31', true)`,
      [id.season, id.league],
    );
    await pool.query(
      `INSERT INTO team (id, name, kind, gender) VALUES
       ($1, 'T-1439 City', 'club', 'men'), ($2, 'T-1439 Chelsea', 'club', 'men')`,
      [id.city, id.chelsea],
    );
    await pool.query(
      `INSERT INTO person (id, full_name) VALUES
       ($1, 'Pep Guardiola'), ($2, 'Enzo Maresca'), ($3, 'T-1439 Player')`,
      [id.guardiola, id.maresca, id.player],
    );
    for (const [type, external, internal] of [
      ['team', ext('city'), id.city],
      ['team', ext('chelsea'), id.chelsea],
      ['person', coachExt('guardiola'), id.guardiola],
      ['person', ext('player'), id.player],
    ] as const) {
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
      `INSERT INTO fixture_participant (id, fixture_id, team_id, side, coach_id) VALUES
       ($1, $3, $4, 'home', NULL), ($2, $3, $5, 'away', $6)`,
      [id.home, id.away, id.fixture, id.city, id.chelsea, id.guardiola],
    );
    // City's line-up named the player's number as its coach before D-230.
    await pool.query(
      `INSERT INTO coach_reference_split (participant_id, person_id, provider, coach_external_id)
       VALUES ($1, $2, 'api_football', $3)`,
      [id.home, id.player, coachExt('maresca')],
    );
  });

  afterAll(async () => {
    if (pool === undefined) return;
    await pool.query(`DELETE FROM fixture WHERE id = $1`, [id.fixture]);
    await pool.query(
      `DELETE FROM provider_mapping WHERE external_id LIKE $1 OR external_id LIKE $2`,
      [`t1439-${RUN}-%`, `coach:t1439-${RUN}-%`],
    );
    await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [
      [id.guardiola, id.maresca, id.player],
    ]);
    await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[id.city, id.chelsea]]);
    await pool.query(`DELETE FROM season WHERE id = $1`, [id.season]);
    await pool.query(`DELETE FROM competition WHERE id = $1`, [id.league]);
    await pool.query(`DELETE FROM country WHERE id = $1`, [id.country]);
    await pool.end();
  });

  it('owes every mapped team of a current season a first ask', async () => {
    expect((await teamsDue()).map((t) => [t.teamId, t.reason]).sort()).toEqual(
      [
        [id.city, 'never_asked'],
        [id.chelsea, 'never_asked'],
      ].sort(),
    );
    expect(await readTeamHeadCoach(pool, id.city, null, null)).toEqual({
      coverage: 'not_supplied',
      last_updated_at: null,
      data: null,
    });
  });

  it('queues a coach we do not hold, writes the career of one we do, and records the answer', async () => {
    const kept = await store.saveTeamCoaches(
      PROVIDER,
      { teamId: id.city, externalId: ext('city'), reason: 'never_asked' },
      [guardiola, maresca()],
      '2026-10-21T10:00:00.000Z',
    );
    expect(kept).toEqual({ coaches: 1, queued: 1, spells: 1, spellsUnmapped: 0 });
    expect(queued).toEqual([
      `${coachExt('maresca')} {"externalId":"${coachExt('maresca')}","name":"E. Maresca"}`,
    ]);
    const { rows } = await pool.query(
      `SELECT team_id, start_date::text, end_date FROM coach_spell WHERE person_id = $1`,
      [id.guardiola],
    );
    expect(rows).toEqual([{ team_id: id.city, start_date: '2016-07-01', end_date: null }]);
    // City was answered: no longer owed, Chelsea still is.
    expect((await teamsDue()).map((t) => t.teamId)).toEqual([id.chelsea]);
    // Until Maresca is adopted, Guardiola's open spell is City's latest.
    const head = await readTeamHeadCoach(pool, id.city, null, null);
    expect(head).toMatchObject({
      coverage: 'available',
      data: { person: { id: id.guardiola, name: 'Pep Guardiola' }, since: '2016-07-01' },
    });
  });

  it('puts a moved-out coach reference back once its coach is adopted', async () => {
    expect(await store.restoreSplitReferences(PROVIDER)).toBe(0);
    // Adoption (D-079): the queued coach becomes a person under his coach id.
    await pool.query(
      `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
       VALUES ('api_football', 'person', $1, $2)`,
      [coachExt('maresca'), id.maresca],
    );
    expect(await store.restoreSplitReferences(PROVIDER)).toBe(1);
    expect(await store.restoreSplitReferences(PROVIDER)).toBe(0);
    const { rows } = await pool.query(`SELECT coach_id FROM fixture_participant WHERE id = $1`, [
      id.home,
    ]);
    expect(rows[0]?.coach_id).toBe(id.maresca);
  });

  it('owes the team an ask when a newer line-up names a coach the careers do not make current', async () => {
    await pool.query(
      `UPDATE team_coach_fetch SET answered_at = now() - interval '5 days' WHERE team_id = $1`,
      [id.city],
    );
    const due = await teamsDue();
    expect(due.find((t) => t.teamId === id.city)?.reason).toBe('lineup_change');
    expect(due[0]?.teamId).toBe(id.city);
  });

  it('writes the adopted coach, keeps only teams we carry, and fills only empty fields', async () => {
    await pool.query(`UPDATE person SET date_of_birth = '1980-02-11' WHERE id = $1`, [id.maresca]);
    const kept = await store.saveTeamCoaches(
      PROVIDER,
      { teamId: id.city, externalId: ext('city'), reason: 'lineup_change' },
      [guardiola, maresca()],
      '2026-10-21T11:00:00.000Z',
    );
    expect(kept).toEqual({ coaches: 2, queued: 0, spells: 3, spellsUnmapped: 1 });
    expect(noted).toContainEqual([id.maresca, 'https://media/12629.png']);
    const { rows } = await pool.query(
      `SELECT date_of_birth::text, nationality_id FROM person WHERE id = $1`,
      [id.maresca],
    );
    expect(rows[0]).toEqual({ date_of_birth: '1980-02-11', nationality_id: id.country });

    // The line-up and the careers agree now.
    expect((await teamsDue()).map((t) => t.teamId)).not.toContain(id.city);
    const head = await readTeamHeadCoach(pool, id.city, null, id.maresca);
    expect(head).toMatchObject({
      coverage: 'available',
      last_updated_at: expect.any(String),
      data: { person: { id: id.maresca }, since: '2026-08-01', lineup_disagrees: false },
    });
    expect(
      (await readTeamHeadCoach(pool, id.city, null, id.guardiola)).data?.lineup_disagrees,
    ).toBe(true);
  });

  it('reads the coach page: the career, current only where the team was answered', async () => {
    const page = await readCoachPage(pool, id.maresca, null);
    expect(page?.coach).toEqual({
      id: id.maresca,
      name: 'Enzo Maresca',
      date_of_birth: '1980-02-11',
      nationality: { id: id.country, name: `T-1439 Land ${RUN}` },
    });
    expect(page?.career.coverage).toBe('limited');
    expect(page?.spells_not_carried).toBe(1);
    expect(page?.career.data?.map((s) => [s.team.id, s.start_date, s.end_date, s.current])).toEqual(
      [
        [id.city, '2026-08-01', null, true],
        // Open, but Chelsea's own coaches were never asked: not called current.
        [id.chelsea, '2024-06-01', null, false],
      ],
    );
    expect(page?.lineups).toEqual({
      count: 1,
      latest: {
        fixture_id: id.fixture,
        kickoff_at: expect.any(String),
        team: { id: id.city, name: 'T-1439 City' },
      },
    });

    const former = await readCoachPage(pool, id.guardiola, null);
    expect(former?.career.data?.map((s) => s.current)).toEqual([false]);
    // A person neither described nor named as a coach has no coach page.
    expect(await readCoachPage(pool, id.player, null)).toBeNull();
    expect(await readCoachPage(pool, randomUUID(), null)).toBeNull();
  });

  it('counts unanswered asks and stops after the last one', async () => {
    const chelsea = {
      teamId: id.chelsea,
      externalId: ext('chelsea'),
      reason: 'never_asked' as const,
    };
    await store.markTeamAsked(PROVIDER, chelsea);
    const retryNow = { answeredBeforeIso: EARLIER, retryBeforeIso: LATER };
    expect((await teamsDue()).map((t) => t.teamId)).not.toContain(id.chelsea);
    expect((await teamsDue(retryNow)).map((t) => t.teamId)).toContain(id.chelsea);
    for (let i = 0; i < 4; i += 1) await store.markTeamAsked(PROVIDER, chelsea);
    expect((await teamsDue(retryNow)).map((t) => t.teamId)).not.toContain(id.chelsea);
  });
});
