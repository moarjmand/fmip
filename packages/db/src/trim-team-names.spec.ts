import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Migration `1765900700000_trim-team-names.sql` against the real schema
 * (T-1711, str-2026-11-02-02): a team name stored with the provider's padding
 * is tidied, a tidy one is left alone. Its Up section only rewrites padded
 * names, so running it again here is harmless.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const MIGRATION = join(__dirname, '..', 'migrations', '1765900700000_trim-team-names.sql');

function upSection(): string {
  const [up = ''] = readFileSync(MIGRATION, 'utf8').split(/^--\s*Down Migration\s*$/m);
  return up;
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'tidying stored team names',
  () => {
    let pool: pg.Pool;
    const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-6);
    const padded = randomUUID();
    const spaced = randomUUID();
    const tidy = randomUUID();

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: DATABASE_URL });
      await pool.query(
        `INSERT INTO team (id, name, short_name, kind, gender, updated_at) VALUES
           ($1, $4, ' Burgh ', 'club', 'men', timestamptz '2026-01-01T00:00:00Z'),
           ($2, $5, '   ', 'club', 'men', timestamptz '2026-01-01T00:00:00Z'),
           ($3, $6, 'Tidy', 'club', 'men', timestamptz '2026-01-01T00:00:00Z')`,
        [
          padded,
          spaced,
          tidy,
          ` T-1711 Johnstone Burgh ${RUN}`,
          `T-1711  Kahramanmaraş \t İstiklal Spor ${RUN} `,
          `T-1711 Tidy ${RUN}`,
        ],
      );
    });

    afterAll(async () => {
      if (pool === undefined) return;
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [[padded, spaced, tidy]]);
      await pool.end();
    });

    it('drops the padding, collapses inner runs, and leaves a tidy name alone', async () => {
      await pool.query(upSection());
      const { rows } = await pool.query<{
        id: string;
        name: string;
        short_name: string | null;
        touched: boolean;
      }>(
        `SELECT id, name, short_name, updated_at > timestamptz '2026-01-01T00:00:00Z' AS touched
           FROM team WHERE id = ANY($1::uuid[])`,
        [[padded, spaced, tidy]],
      );
      const of = (id: string) => rows.find((r) => r.id === id);
      expect(of(padded)).toMatchObject({
        name: `T-1711 Johnstone Burgh ${RUN}`,
        short_name: 'Burgh',
        touched: true,
      });
      // A short name left blank by tidying is no short name.
      expect(of(spaced)).toMatchObject({
        name: `T-1711 Kahramanmaraş İstiklal Spor ${RUN}`,
        short_name: null,
        touched: true,
      });
      expect(of(tidy)).toMatchObject({
        name: `T-1711 Tidy ${RUN}`,
        short_name: 'Tidy',
        touched: false,
      });
    });
  },
);
