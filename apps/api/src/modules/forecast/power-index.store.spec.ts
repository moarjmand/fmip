import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { POWER_INDEX_WEIGHTS } from '@fmip/contracts';
import { POWER_INDEX_FORMULA_VERSION, combine } from './internal/power-index';

// The `power_index` table against the real schema (T-110): a stored index is
// immutable and carries everything needed to reproduce it. Nothing writes this
// table yet — T-111 measures the components — so the test writes a row the way
// the formula would and checks the database's own guarantees.
const DATABASE_URL = process.env.DATABASE_URL;

const SEEDED_FIXTURE = '00000000-0000-4000-8000-000000000901';

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')('the power index table', () => {
  let pool: Pool;
  let participantId: string;
  const written: string[] = [];

  beforeAll(async () => {
    pool = new Pool({ connectionString: DATABASE_URL });
    const { rows } = await pool.query<{ id: string }>(
      `SELECT id FROM fixture_participant WHERE fixture_id = $1 AND side = 'home'`,
      [SEEDED_FIXTURE],
    );
    participantId = rows[0]?.id ?? '';
    expect(participantId, 'the development seed must be loaded').not.toBe('');
  });

  afterAll(async () => {
    if (pool === undefined) return;
    // The rows are immutable, so cleanup has to go around the trigger the same
    // way every other immutable table's cleanup does.
    await pool.query(`ALTER TABLE power_index DISABLE TRIGGER power_index_immutable`);
    await pool.query(`DELETE FROM power_index WHERE id = ANY($1::uuid[])`, [written]);
    await pool.query(`ALTER TABLE power_index ENABLE TRIGGER power_index_immutable`);
    await pool.end();
  });

  async function insert(
    computedAt: string,
    overrides: { value?: number; completeness?: number; components?: unknown } = {},
  ): Promise<string> {
    const combined = combine({
      underlying_strength: { value: 0.8 },
      recent_form: { value: 0.6 },
      venue: { value: 0.55 },
      rest_and_congestion: { value: 0.5 },
      competition_context: { value: 0.5 },
    });
    const { rows } = await pool.query<{ id: string }>(
      `INSERT INTO power_index
         (participant_id, formula_version, value, completeness, components, inputs_hash, computed_at)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7)
       RETURNING id`,
      [
        participantId,
        POWER_INDEX_FORMULA_VERSION,
        overrides.value ?? combined?.value,
        overrides.completeness ?? combined?.completeness,
        JSON.stringify(overrides.components ?? combined?.components),
        'test-inputs-hash',
        computedAt,
      ],
    );
    const id = rows[0]?.id as string;
    written.push(id);
    return id;
  }

  it('stores the index with every component and the weight it carried', async () => {
    const id = await insert('2026-01-05T18:00:00Z');
    const { rows } = await pool.query<{
      value: string;
      completeness: string;
      components: { key: string; weight: number; value: number | null; state: string }[];
    }>(`SELECT value, completeness, components FROM power_index WHERE id = $1`, [id]);

    const row = rows[0];
    expect(Number(row?.completeness)).toBeCloseTo(0.75, 4);
    // Every component is present, including the two nothing supplied — the row
    // says what was missing, not just what was there (rule 3).
    expect(row?.components).toHaveLength(Object.keys(POWER_INDEX_WEIGHTS).length);
    const absent = row?.components.filter((c) => c.state === 'not_supplied') ?? [];
    expect(absent.map((c) => c.key).sort()).toEqual(['lineup_quality', 'stability']);
    expect(absent.every((c) => c.value === null)).toBe(true);

    // Recomputable from the row alone: the stored components reproduce the
    // stored value, with no access to whatever measured them.
    const supplied = row?.components.filter((c) => c.value !== null) ?? [];
    const suppliedWeight = supplied.reduce((sum, c) => sum + c.weight, 0);
    const recomputed =
      supplied.reduce((sum, c) => sum + (c.value as number) * (c.weight / suppliedWeight), 0) * 100;
    expect(Number(row?.value)).toBeCloseTo(recomputed, 1);
  });

  it('refuses to be rewritten or deleted (rule 5)', async () => {
    const id = await insert('2026-01-05T18:05:00Z');
    await expect(
      pool.query(`UPDATE power_index SET value = 99 WHERE id = $1`, [id]),
    ).rejects.toThrow(/immutable/);
    await expect(pool.query(`DELETE FROM power_index WHERE id = $1`, [id])).rejects.toThrow(
      /immutable/,
    );
  });

  it('refuses an index outside 0-100, and one built from nothing', async () => {
    await expect(insert('2026-01-05T18:10:00Z', { value: 140 })).rejects.toThrow(
      /power_index_value_range/,
    );
    // Completeness of zero would mean no component was supplied, which is the
    // absence of an index rather than a weak one.
    await expect(insert('2026-01-05T18:15:00Z', { completeness: 0 })).rejects.toThrow(
      /power_index_completeness_range/,
    );
    await expect(insert('2026-01-05T18:20:00Z', { components: [] })).rejects.toThrow(
      /power_index_components_present/,
    );
  });

  it('keeps one index per side per formula per moment, so a recomputation is a new row', async () => {
    const when = '2026-01-05T18:30:00Z';
    await insert(when);
    await expect(insert(when)).rejects.toThrow(/power_index_one_per_moment/);
    // A later computation is a new row, not an edit: that is what makes "what
    // changed after the confirmed line-up" answerable (T-121).
    await expect(insert('2026-01-05T19:00:00Z')).resolves.toBeTypeOf('string');
  });
});
