import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
// @ts-expect-error -- a plain script, deliberately not part of the TypeScript build.
import * as script from '../scripts/catalog.mjs';

const parseArgs = script.parseArgs as (argv: string[]) => Record<string, unknown> & {
  error?: string;
};

/**
 * `catalog.mjs --set-order --locale` (T-1391, D-207): a language's own order
 * of the competitions, kept apart from the default one (`display_order`),
 * audited with the language and the place it had before (rule 10). The
 * language subtag used here is one no other suite uses, so its rows are this
 * file's alone; the competition is a scratch one with a far-away provider id.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const SCRIPT = join(__dirname, '..', 'scripts', 'catalog.mjs');
const run = promisify(execFile);

async function catalog(args: string[]): Promise<{ code: number; stdout: string }> {
  try {
    const { stdout } = await run(process.execPath, [SCRIPT, ...args], {
      env: { ...process.env, DATABASE_URL },
    });
    return { code: 0, stdout };
  } catch (error) {
    const e = error as { code: number; stdout: string };
    return { code: e.code, stdout: e.stdout };
  }
}

describe('--set-order --locale, parsed', () => {
  it('reads a language subtag, and refuses anything else', () => {
    expect(
      parseArgs(['--set-order', '--competition', '39', '--order', '1', '--locale', 'en']),
    ).toMatchObject({ command: 'set-order', competition: '39', order: 1, locale: 'en' });
    expect(parseArgs(['--set-order', '--competition', '39', '--order', '1'])).toMatchObject({
      locale: null,
    });
    expect(
      parseArgs(['--set-order', '--competition', '39', '--order', '1', '--locale', 'en-GB']).error,
    ).toContain('--locale');
  });
});

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'a language’s own competition order (T-1391, D-207)',
  () => {
    let pool: pg.Pool;
    const admin = randomUUID();
    const email = `t1391-${admin}@example.test`;
    const competition = randomUUID();
    const externalId = String(930_000_000 + Math.floor(Math.random() * 60_000_000));

    const place = async () =>
      (
        await pool.query<{ position: number }>(
          `SELECT position FROM competition_display_order WHERE competition_id = $1 AND locale = 'xq'`,
          [competition],
        )
      ).rows[0]?.position ?? null;

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: DATABASE_URL });
      const country = await pool.query<{ id: string }>(`SELECT id FROM country LIMIT 1`);
      await pool.query(
        `INSERT INTO user_account
         (id, username, display_name, email, country_id, preferred_language, timezone,
          accepted_rules_at, status)
       VALUES ($1, $2, 'T-1391 admin', $3, $4, 'en', 'UTC', now(), 'active')`,
        [admin, `t1391_${admin.slice(0, 8)}`, email, country.rows[0]?.id],
      );
      await pool.query(
        `INSERT INTO competition (id, name, kind, scope, gender, age_group, is_active, country_id)
         VALUES ($1, 'T-1391 league', 'league', 'domestic', 'men', 'senior', true, $2)`,
        [competition, country.rows[0]?.id],
      );
      await pool.query(
        `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
         VALUES ('api_football', 'competition', $1, $2)`,
        [externalId, competition],
      );
    });

    afterAll(async () => {
      if (pool === undefined) return;
      const client = await pool.connect();
      try {
        await client.query(`SET session_replication_role = 'replica'`);
        await client.query(`DELETE FROM audit_log WHERE actor_id = $1`, [admin]);
      } finally {
        await client.query(`SET session_replication_role = 'origin'`);
        client.release();
      }
      await pool.query(`DELETE FROM user_account WHERE id = $1`, [admin]);
      await pool.query(
        `DELETE FROM provider_mapping WHERE provider = 'api_football' AND entity_type = 'competition' AND external_id = $1`,
        [externalId],
      );
      await pool.query(`DELETE FROM competition WHERE id = $1`, [competition]);
      await pool.end();
    });

    it('places, moves and clears it, leaving the default order alone, audited each time', async () => {
      const set = (order: string) =>
        catalog([
          '--set-order',
          '--competition',
          externalId,
          '--order',
          order,
          '--locale',
          'xq',
          '--by',
          email,
        ]);

      expect((await set('2')).code).toBe(0);
      expect(await place()).toBe(2);
      expect((await set('1')).code).toBe(0);
      expect(await place()).toBe(1);
      const { rows: def } = await pool.query<{ display_order: number | null }>(
        `SELECT display_order FROM competition WHERE id = $1`,
        [competition],
      );
      expect(def[0]?.display_order).toBeNull();
      expect((await set('0')).code).toBe(0);
      expect(await place()).toBeNull();

      const { rows } = await pool.query<{ previous: unknown; next: unknown }>(
        `SELECT previous, next FROM audit_log
          WHERE actor_id = $1 AND action = 'catalog.competition_order_set'
          ORDER BY created_at, id`,
        [admin],
      );
      expect(rows).toEqual([
        {
          previous: { locale: 'xq', display_order: null },
          next: { locale: 'xq', display_order: 2 },
        },
        { previous: { locale: 'xq', display_order: 2 }, next: { locale: 'xq', display_order: 1 } },
        {
          previous: { locale: 'xq', display_order: 1 },
          next: { locale: 'xq', display_order: null },
        },
      ]);
    });
  },
);
