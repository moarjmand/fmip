import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PersonNameStore } from './person-name-store';
import { fullNameFromProfile } from './person-names';

/**
 * The `people_names` job's SQL against the real schema (T-1398, D-213): who is
 * owed an ask, which names are left alone because a person chose them, the
 * ask record, and the one compare-and-set write of a full name with its alias.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const PROVIDER = 'api_football' as const;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the people names store', () => {
  let pool: Pool;
  let store: PersonNameStore;
  let admin = '';
  const p = {
    short: randomUUID(),
    shortFailed: randomUUID(),
    full: randomUUID(),
    knownAs: randomUUID(),
    unmapped: randomUUID(),
    renamed: randomUUID(),
    edited: randomUUID(),
    adopted: randomUUID(),
    changing: randomUUID(),
  };
  const ext = (n: string) => `t1398-${RUN}-${n}`;
  const ids: string[] = Object.values(p);
  const due = async (askedBefore = new Date(Date.now() + 60_000).toISOString(), max = 5) =>
    (await store.peopleNamesDue(PROVIDER, askedBefore, max, 10_000)).filter((x) =>
      ids.includes(x.personId),
    );

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    store = new PersonNameStore(pool);
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO user_account
         (username, display_name, email, country_id, preferred_language, timezone, accepted_rules_at)
       SELECT $1, 'Names Admin', $2, id, 'en', 'UTC', now() FROM country WHERE code = 'IRN'
       RETURNING id`,
      [`pn${RUN}`, `pn${RUN}@example.test`],
    );
    admin = rows[0]?.id ?? '';
    await pool.query(
      `INSERT INTO person (id, full_name, known_as) VALUES
         ($1, 'M. Salah', NULL), ($2, 'P. O&apos;Neill', NULL), ($3, 'Mohamed Salah', NULL),
         ($4, 'K. Player', 'Kay'), ($5, 'U. Nmapped', NULL), ($6, 'R. Enamed', NULL),
         ($7, 'E. Dited', NULL), ($8, 'A. Dopted', NULL), ($9, 'C. Hanging', NULL)`,
      [
        p.short,
        p.shortFailed,
        p.full,
        p.knownAs,
        p.unmapped,
        p.renamed,
        p.edited,
        p.adopted,
        p.changing,
      ],
    );
    const mapped = [
      p.short,
      p.shortFailed,
      p.full,
      p.knownAs,
      p.renamed,
      p.edited,
      p.adopted,
      p.changing,
    ];
    for (const [i, id] of mapped.entries()) {
      await pool.query(
        `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
         VALUES ('api_football', 'person', $1, $2)`,
        [ext(String(i)), id],
      );
    }
    // Adopted under the name still stored: the feed's name, so it may be asked about.
    // Adopted under another name than the one stored now: somebody changed it.
    // Any other audited action on the person: a person chose the name.
    await pool.query(
      `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, next) VALUES
         ($1, 'catalog.person_added', 'person', $2, 'adopted', '{"name": "A. Dopted"}'),
         ($1, 'catalog.person_added', 'person', $3, 'adopted', '{"name": "R. Old"}'),
         ($1, 'catalog.person_renamed', 'person', $4, 'by hand', '{"name": "E. Dited"}')`,
      [admin, p.adopted, p.renamed, p.edited],
    );
  });

  afterAll(async () => {
    await pool.query(
      `DELETE FROM entity_alias WHERE entity_type = 'person' AND entity_id = ANY($1::uuid[])`,
      [ids],
    );
    await pool.query(
      `DELETE FROM provider_mapping WHERE entity_type = 'person' AND internal_id = ANY($1::uuid[])`,
      [ids],
    );
    // audit_log is immutable (`refuse_change`): its rows and their person and user stay.
    await pool.query(
      `DELETE FROM person WHERE id = ANY($1::uuid[])
          AND NOT EXISTS (SELECT 1 FROM audit_log a WHERE a.target_id = person.id::text)`,
      [ids],
    );
    await pool.end();
  });

  it('is owed: mapped, a short form, no known_as, and no sign a person chose the name', async () => {
    const owed = (await due()).map((x) => x.personId).sort();
    expect(owed).toEqual([p.short, p.shortFailed, p.adopted, p.changing].sort());
    const salah = (await due()).find((x) => x.personId === p.short);
    expect(salah).toMatchObject({ storedName: 'M. Salah', externalId: ext('0') });
  });

  it('asks an unanswered person again only after the retry interval, and only so often', async () => {
    await store.markPersonNameAsked(PROVIDER, p.shortFailed);
    const before = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    expect((await due(before)).map((x) => x.personId)).not.toContain(p.shortFailed);
    expect((await due()).map((x) => x.personId)).toContain(p.shortFailed);
    await store.markPersonNameAsked(PROVIDER, p.shortFailed);
    const { rows } = await pool.query<{ attempts: number; answered_at: string | null }>(
      `SELECT attempts, answered_at FROM person_name_fetch WHERE person_id = $1`,
      [p.shortFailed],
    );
    expect(rows[0]).toEqual({ attempts: 2, answered_at: null });
    expect((await due(undefined, 2)).map((x) => x.personId)).not.toContain(p.shortFailed);
  });

  it('writes the full name, keeps the short form as an alias, records both, and never asks again', async () => {
    const person = (await due()).find((x) => x.personId === p.short)!;
    const answer = fullNameFromProfile(person.storedName, {
      externalId: person.externalId,
      shortName: null,
      name: {
        fullName: 'Mohamed Salah Hamed Mahrous Ghaly',
        givenName: 'Mohamed',
        familyName: 'Salah Hamed Mahrous Ghaly',
      },
      bio: { dateOfBirth: null, nationality: null, heightCm: null, preferredFoot: null },
    });
    expect(await store.recordPersonNameAnswer(PROVIDER, person, answer)).toBe('written');
    const stored = await pool.query(`SELECT full_name, known_as FROM person WHERE id = $1`, [
      p.short,
    ]);
    expect(stored.rows[0]).toEqual({ full_name: 'Mohamed Salah', known_as: null });
    const alias = await pool.query(
      `SELECT alias, language, kind, source FROM entity_alias WHERE entity_type = 'person' AND entity_id = $1`,
      [p.short],
    );
    expect(alias.rows).toEqual([
      { alias: 'M. Salah', language: null, kind: 'abbreviation', source: 'api_football' },
    ]);
    const record = await pool.query(
      `SELECT outcome, previous_name, written_name, profile_name, attempts
         FROM person_name_fetch WHERE person_id = $1`,
      [p.short],
    );
    expect(record.rows[0]).toEqual({
      outcome: 'written',
      previous_name: 'M. Salah',
      written_name: 'Mohamed Salah',
      profile_name: 'Mohamed Salah Hamed Mahrous Ghaly',
      attempts: 1,
    });
    expect((await due()).map((x) => x.personId)).not.toContain(p.short);
    // Search reads aliases through `search_key`: the short form still finds him.
    const found = await pool.query(
      `SELECT entity_id FROM entity_alias WHERE search_key(alias) = search_key('m. salah') AND entity_id = $1`,
      [p.short],
    );
    expect(found.rowCount).toBe(1);
  });

  it('keeps a name that changed after it was read', async () => {
    const person = (await due()).find((x) => x.personId === p.changing)!;
    await pool.query(`UPDATE person SET full_name = 'Chosen Name' WHERE id = $1`, [p.changing]);
    const answer = fullNameFromProfile(person.storedName, {
      externalId: person.externalId,
      shortName: null,
      name: {
        fullName: 'Carl Hanging',
        givenName: 'Carl',
        familyName: 'Hanging',
      },
      bio: { dateOfBirth: null, nationality: null, heightCm: null, preferredFoot: null },
    });
    expect(answer.outcome).toBe('written');
    expect(await store.recordPersonNameAnswer(PROVIDER, person, answer)).toBe('name_kept');
    const stored = await pool.query(`SELECT full_name FROM person WHERE id = $1`, [p.changing]);
    expect(stored.rows[0]).toEqual({ full_name: 'Chosen Name' });
    const alias = await pool.query(
      `SELECT 1 FROM entity_alias WHERE entity_type = 'person' AND entity_id = $1`,
      [p.changing],
    );
    expect(alias.rowCount).toBe(0);
    const record = await pool.query(
      `SELECT outcome, previous_name, written_name FROM person_name_fetch WHERE person_id = $1`,
      [p.changing],
    );
    expect(record.rows[0]).toEqual({
      outcome: 'name_kept',
      previous_name: null,
      written_name: null,
    });
  });

  it('records a disagreeing profile without touching the name', async () => {
    const person = (await due()).find((x) => x.personId === p.adopted)!;
    const answer = fullNameFromProfile(person.storedName, {
      externalId: person.externalId,
      shortName: null,
      name: {
        fullName: 'Anna Other',
        givenName: 'Anna',
        familyName: 'Other',
      },
      bio: { dateOfBirth: null, nationality: null, heightCm: null, preferredFoot: null },
    });
    expect(await store.recordPersonNameAnswer(PROVIDER, person, answer)).toBe(
      'family_name_differs',
    );
    const stored = await pool.query(`SELECT full_name FROM person WHERE id = $1`, [p.adopted]);
    expect(stored.rows[0]).toEqual({ full_name: 'A. Dopted' });
    const record = await pool.query(
      `SELECT outcome, detail FROM person_name_fetch WHERE person_id = $1`,
      [p.adopted],
    );
    expect(record.rows[0]?.outcome).toBe('family_name_differs');
    expect(record.rows[0]?.detail).toMatch(/Dopted/);
  });
});
