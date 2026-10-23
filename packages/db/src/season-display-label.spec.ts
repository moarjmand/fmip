import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * `season_display_label` (T-1483, D-256): a season played within one calendar
 * year is shown by its year; every other label is shown as stored. The cases
 * are production's seasons on 2026-10-23.
 */
const DATABASE_URL = process.env.DATABASE_URL;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'what a page calls a season',
  () => {
    let pool: pg.Pool;
    beforeAll(() => {
      pool = new pg.Pool({ connectionString: DATABASE_URL });
    });
    afterAll(async () => {
      await pool.end();
    });

    const shown = async (label: string, start: string) =>
      (
        await pool.query<{ shown: string }>(`SELECT season_display_label($1, $2::date) AS shown`, [
          label,
          start,
        ])
      ).rows[0]?.shown;

    it('shows a calendar-year season by its year', async () => {
      expect(await shown('2026/27', '2026-02-04')).toBe('2026'); // Libertadores
      expect(await shown('2026/27', '2026-01-28')).toBe('2026'); // Brasileirão
      expect(await shown('2027/28', '2027-01-07')).toBe('2027'); // the Asian Cup
    });

    it('keeps two years for a season that crosses them, or whose label is another year', async () => {
      expect(await shown('2026/27', '2026-08-21')).toBe('2026/27'); // Premier League
      expect(await shown('2026/27', '2026-07-07')).toBe('2026/27'); // Champions League qualifiers
      expect(await shown('2026/27', '2026-08-14')).toBe('2026/27'); // Pro League
      expect(await shown('2027/28', '2026-03-25')).toBe('2027/28'); // a qualification labelled ahead
      expect(await shown('2026', '2026-02-01')).toBe('2026');
    });
  },
);
