import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PersonBioStore } from './person-bio-store';
import { bioFromProfile } from './person-bios';

/**
 * The bio pass's SQL against the real schema (T-1428, D-220): who is owed an
 * ask (players only, with an empty field, squad members first), the ask
 * record, and the write, which fills only the empty fields.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const PROVIDER = 'api_football' as const;
const SEASON = '00000000-0000-4000-8000-000000000302';
const STAGE = '00000000-0000-4000-8000-000000000401';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the people bios store', () => {
  let pool: Pool;
  let store: PersonBioStore;
  const p = {
    player: randomUUID(),
    listed: randomUUID(),
    full: randomUUID(),
    coach: randomUUID(),
    unmapped: randomUUID(),
    partly: randomUUID(),
    adoptedCoach: randomUUID(),
  };
  const team = randomUUID();
  const fixture = randomUUID();
  const ids: string[] = Object.values(p);
  const ext = (n: string) => `t1428-${RUN}-${n}`;
  const due = async (askedBefore = new Date(Date.now() + 60_000).toISOString(), max = 5) =>
    (await store.peopleBiosDue(PROVIDER, askedBefore, max, 100_000)).filter((x) =>
      ids.includes(x.personId),
    );
  const held = async (id: string) =>
    (
      await pool.query<{
        date_of_birth: string | null;
        nationality: string | null;
        height_cm: number | null;
      }>(
        `SELECT p.date_of_birth::text, c.code AS nationality, p.height_cm
           FROM person p LEFT JOIN country c ON c.id = p.nationality_id WHERE p.id = $1`,
        [id],
      )
    ).rows[0];

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new PersonBioStore(pool);
    await pool.query(
      `INSERT INTO person (id, full_name, date_of_birth, nationality_id, height_cm, preferred_foot)
       VALUES ($1, 'M. Salah', NULL, NULL, NULL, NULL),
              ($2, 'L. Isted', NULL, NULL, NULL, NULL),
              ($3, 'F. Ull', DATE '1990-01-01', (SELECT id FROM country WHERE code = 'ENG'), 180, 'left'),
              ($4, 'C. Oach', NULL, NULL, NULL, NULL),
              ($5, 'U. Nmapped', NULL, NULL, NULL, NULL),
              ($6, 'P. Artly', DATE '1995-05-05', NULL, 170, NULL),
              ($7, 'Nico Estevez', NULL, NULL, NULL, NULL)`,
      [p.player, p.listed, p.full, p.coach, p.unmapped, p.partly, p.adoptedCoach],
    );
    for (const [key, id] of Object.entries(p)) {
      if (key === 'unmapped') continue;
      // A coach adopted from a line-up: no match or spell yet, his id says so (T-1474).
      const external = key === 'adoptedCoach' ? `coach:${ext(key)}` : ext(key);
      await pool.query(
        `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
         VALUES ('api_football', 'person', $1, $2)`,
        [external, id],
      );
    }
    await pool.query(`INSERT INTO team (id, name, kind, gender) VALUES ($1, $2, 'club', 'men')`, [
      team,
      `Bio Club ${RUN}`,
    ]);
    await pool.query(
      `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
       VALUES ($1, $2, $3, 'Matchday', now(), 'scheduled')`,
      [fixture, SEASON, STAGE],
    );
    await pool.query(
      `INSERT INTO fixture_participant (fixture_id, team_id, side, coach_id) VALUES ($1, $2, 'home', $3)`,
      [fixture, team, p.coach],
    );
    await pool.query(
      `INSERT INTO team_squad_member (team_id, person_id, provider, shirt_number, position)
       VALUES ($1, $2, 'api_football', 9, 'forward')`,
      [team, p.listed],
    );
  });

  afterAll(async () => {
    if (pool === undefined) return;
    await pool.query(`DELETE FROM fixture_participant WHERE fixture_id = $1`, [fixture]);
    await pool.query(`DELETE FROM fixture WHERE id = $1`, [fixture]);
    await pool.query(`DELETE FROM team WHERE id = $1`, [team]);
    await pool.query(
      `DELETE FROM provider_mapping WHERE external_id LIKE $1 OR external_id LIKE $2`,
      [`t1428-${RUN}-%`, `coach:t1428-${RUN}-%`],
    );
    await pool.query(`DELETE FROM person WHERE id = ANY($1::uuid[])`, [ids]);
    await pool.end();
  });

  it('is owed: mapped players with an empty field, never a coach, squad members first', async () => {
    const owed = await due();
    expect(owed.map((x) => x.personId).sort()).toEqual(
      // F. Ull has every field: nothing to ask for.
      [p.player, p.listed, p.partly].sort(),
    );
    expect(owed[0]?.personId).toBe(p.listed);
    expect(owed.find((x) => x.personId === p.player)).toMatchObject({
      externalId: ext('player'),
      names: ['M. Salah'],
    });
  });

  it('fills the empty fields from an agreeing profile, records them, and never asks again', async () => {
    const countries = await store.countries();
    const answer = bioFromProfile(
      ['M. Salah'],
      {
        externalId: ext('player'),
        shortName: 'M. Salah',
        name: null,
        bio: {
          dateOfBirth: '1992-06-15',
          nationality: { name: 'Egypt', code: null },
          heightCm: 175,
          preferredFoot: null,
        },
      },
      countries,
      new Date(),
    );
    expect(await store.recordPersonBioAnswer(PROVIDER, p.player, answer)).toBe('written');
    expect(await held(p.player)).toEqual({
      date_of_birth: '1992-06-15',
      nationality: 'EGY',
      height_cm: 175,
    });
    const { rows } = await pool.query(
      `SELECT outcome, written, attempts, answered_at IS NOT NULL AS answered
         FROM person_bio_fetch WHERE person_id = $1`,
      [p.player],
    );
    expect(rows[0]).toMatchObject({
      outcome: 'written',
      attempts: 1,
      answered: true,
      written: {
        date_of_birth: '1992-06-15',
        nationality_id: countries.find((c) => c.code === 'EGY')!.id,
        height_cm: 175,
      },
    });
    expect((await due()).map((x) => x.personId)).not.toContain(p.player);
  });

  it('never overwrites a value already held', async () => {
    const answer = bioFromProfile(
      ['P. Artly'],
      {
        externalId: ext('partly'),
        shortName: 'P. Artly',
        name: null,
        bio: {
          dateOfBirth: '2000-01-01',
          nationality: { name: 'Korea Republic', code: 'KOR' },
          heightCm: 190,
          preferredFoot: null,
        },
      },
      await store.countries(),
      new Date(),
    );
    expect(await store.recordPersonBioAnswer(PROVIDER, p.partly, answer)).toBe('written');
    expect(await held(p.partly)).toEqual({
      date_of_birth: '1995-05-05',
      nationality: 'KOR',
      height_cm: 170,
    });
    const full = bioFromProfile(
      ['F. Ull'],
      {
        externalId: ext('full'),
        shortName: 'F. Ull',
        name: null,
        bio: { dateOfBirth: '2001-01-01', nationality: null, heightCm: 160, preferredFoot: null },
      },
      [],
      new Date(),
    );
    expect(await store.recordPersonBioAnswer(PROVIDER, p.full, full)).toBe('nothing_new');
    expect(await held(p.full)).toMatchObject({ date_of_birth: '1990-01-01', height_cm: 180 });
  });

  it('records a disagreeing profile without writing', async () => {
    const answer = bioFromProfile(
      ['L. Isted'],
      {
        externalId: ext('listed'),
        shortName: 'Someone Else',
        name: null,
        bio: { dateOfBirth: '1999-09-09', nationality: null, heightCm: 181, preferredFoot: null },
      },
      [],
      new Date(),
    );
    expect(await store.recordPersonBioAnswer(PROVIDER, p.listed, answer)).toBe('name_differs');
    expect(await held(p.listed)).toEqual({
      date_of_birth: null,
      nationality: null,
      height_cm: null,
    });
  });

  it('counts each unanswered ask', async () => {
    await store.markPersonBioAsked(PROVIDER, p.coach);
    await store.markPersonBioAsked(PROVIDER, p.coach);
    const { rows } = await pool.query<{ attempts: number; answered_at: string | null }>(
      `SELECT attempts, answered_at FROM person_bio_fetch WHERE person_id = $1`,
      [p.coach],
    );
    expect(rows[0]).toEqual({ attempts: 2, answered_at: null });
  });
});
