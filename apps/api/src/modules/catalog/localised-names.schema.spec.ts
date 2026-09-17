import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Localised entity names, against the real schema (T-303).
 *
 * Nothing in the API reads these yet -- the service is the second half of the
 * task -- so this writes what the service will read and checks the guarantees
 * that belong to the database rather than to any caller:
 *
 * - a name is a row against the canonical id, never a second entity (rule 1);
 * - a name has a language, and there is one per language per entity;
 * - `localised_name()` answers the row, and NULL when nobody has written one;
 * - a name row is an alias row, so the predicate search already uses finds it.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const ENGLAND = '00000000-0000-4000-8000-000000000101';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);

/** The similarity floor the search store applies (search-store.ts). */
const MIN_SIMILARITY = 0.3;

interface Codeful {
  code?: string;
  constraint?: string;
}

const sqlstate = (error: unknown): string | undefined => (error as Codeful).code;
const constraintOf = (error: unknown): string | undefined => (error as Codeful).constraint;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('localised names', () => {
  let pool: Pool;
  let team = '';

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO team (name, short_name, code, kind, gender, age_group, country_id)
       VALUES ($1, 'LNT', 'LNT', 'club', 'men', 'senior', $2)
       RETURNING id`,
      [`Localised Names Test ${RUN}`, ENGLAND],
    );
    team = rows[0]?.id ?? '';
  });

  afterAll(async () => {
    if (team !== '') {
      await pool.query(`DELETE FROM entity_alias WHERE entity_id = $1`, [team]);
      await pool.query(`DELETE FROM team WHERE id = $1`, [team]);
    }
    await pool.end();
  });

  it('is a row against the canonical id, one per language', async () => {
    await pool.query(
      `INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
       VALUES ('team', $1, 'نادي الاختبار', 'ar', 'name', 'test'),
              ('team', $1, 'Club de Prueba', 'es', 'name', 'test')`,
      [team],
    );
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM team WHERE id = $1`,
      [team],
    );
    // Still one team. The names hang off it; they are not it.
    expect(rows[0]?.n).toBe('1');
  });

  it('refuses a second name in the same language, by the index that says so', async () => {
    await expect(
      pool.query(
        `INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
         VALUES ('team', $1, 'نادي آخر', 'ar', 'name', 'test')`,
        [team],
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expect(sqlstate(error)).toBe('23505');
      expect(constraintOf(error)).toBe('entity_alias_one_name_per_language');
      return true;
    });
  });

  it('refuses a name with no language, because that would be the canonical name', async () => {
    await expect(
      pool.query(
        `INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
         VALUES ('team', $1, 'Nameless', NULL, 'name', 'test')`,
        [team],
      ),
    ).rejects.toSatisfy((error: unknown) => {
      expect(sqlstate(error)).toBe('23514');
      expect(constraintOf(error)).toBe('entity_alias_name_has_language');
      return true;
    });
  });

  it('leaves the other kinds as they were: an alias may still be universal', async () => {
    await pool.query(
      `INSERT INTO entity_alias (entity_type, entity_id, alias, language, kind, source)
       VALUES ('team', $1, 'LN Test', NULL, 'abbreviation', 'test')`,
      [team],
    );
    const { rows } = await pool.query<{ n: string }>(
      `SELECT count(*) AS n FROM entity_alias WHERE entity_id = $1`,
      [team],
    );
    expect(rows[0]?.n).toBe('3');
  });

  it('answers localised_name() with the row, and NULL when nobody has written one', async () => {
    const { rows } = await pool.query<{ ar: string | null; es: string | null; tr: string | null }>(
      `SELECT localised_name('team', $1, 'ar') AS ar,
              localised_name('team', $1, 'es') AS es,
              localised_name('team', $1, 'tr') AS tr`,
      [team],
    );
    expect(rows[0]).toEqual({ ar: 'نادي الاختبار', es: 'Club de Prueba', tr: null });
  });

  it('never answers with the English for a language nobody wrote', async () => {
    // NULL, not the canonical name: the caller decides what a missing name
    // looks like, and it must look missing (rule 3, applied to language).
    const { rows } = await pool.query<{ name: string | null }>(
      `SELECT localised_name('team', $1, 'de') AS name`,
      [team],
    );
    expect(rows[0]?.name).toBeNull();
  });

  it('is found by the predicate search already applies to every alias', async () => {
    // The same comparison search-store.ts makes, on the same index expression:
    // a name row is an alias row, so nothing had to be taught to find it.
    const { rows } = await pool.query<{ alias: string }>(
      `SELECT alias
         FROM entity_alias
        WHERE entity_id = $1
          AND kind = 'name'
          AND GREATEST(
                word_similarity(search_key($2), search_key(alias)),
                CASE WHEN search_key(alias) LIKE search_key($2) || '%' THEN 1 ELSE 0 END
              ) >= $3`,
      [team, 'club de prueba', MIN_SIMILARITY],
    );
    expect(rows.map((r) => r.alias)).toEqual(['Club de Prueba']);
  });
});
