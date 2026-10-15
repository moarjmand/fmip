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
 * `catalog.mjs --set-colour` (T-1416, D-218): an editor's club colour, which
 * the shirts' derivation never overwrites, and `none` to hand the club back
 * to it -- audited with the reason and the colour before (rule 10). The team
 * is a scratch one with a far-away provider id and no matches, so its
 * derived colour is none.
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

describe('--set-colour, parsed', () => {
  const base = ['--set-colour', '--team', '33', '--reason', 'the club’s own red'];

  it('reads #rrggbb in any case, or none, and needs a reason', () => {
    expect(parseArgs([...base, '--colour', '#DA291C'])).toMatchObject({
      command: 'set-colour',
      team: '33',
      colour: '#da291c',
      reason: 'the club’s own red',
    });
    expect(parseArgs([...base, '--colour', 'none'])).toMatchObject({ colour: null });
    for (const bad of ['da291c', '#fff', 'red', '#da291cc', '']) {
      expect(parseArgs([...base, '--colour', bad]).error).toContain('--colour');
    }
    expect(parseArgs(['--set-colour', '--team', '33', '--colour', '#da291c']).error).toContain(
      '--reason',
    );
    expect(parseArgs(['--set-colour', '--colour', '#da291c', '--reason', 'x']).error).toContain(
      '--team',
    );
  });
});

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'an editor’s club colour (T-1416, D-218)',
  () => {
    let pool: pg.Pool;
    const admin = randomUUID();
    const email = `t1416-${admin}@example.test`;
    const team = randomUUID();
    const externalId = String(930_000_000 + Math.floor(Math.random() * 60_000_000));

    const colourOf = async () =>
      (
        await pool.query<{ colour: string | null; colour_source: string | null }>(
          `SELECT colour, colour_source FROM team WHERE id = $1`,
          [team],
        )
      ).rows[0];

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: DATABASE_URL });
      const country = await pool.query<{ id: string }>(`SELECT id FROM country LIMIT 1`);
      await pool.query(
        `INSERT INTO user_account
         (id, username, display_name, email, country_id, preferred_language, timezone,
          accepted_rules_at, status)
       VALUES ($1, $2, 'T-1416 editor', $3, $4, 'en', 'UTC', now(), 'active')`,
        [admin, `t1416_${admin.slice(0, 8)}`, email, country.rows[0]?.id],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, country_id, gender)
         VALUES ($1, 'T-1416 United', 'club', $2, 'men')`,
        [team, country.rows[0]?.id],
      );
      await pool.query(
        `INSERT INTO provider_mapping (provider, entity_type, external_id, internal_id)
         VALUES ('api_football', 'team', $1, $2)`,
        [externalId, team],
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
        `DELETE FROM provider_mapping WHERE provider = 'api_football' AND entity_type = 'team' AND external_id = $1`,
        [externalId],
      );
      await pool.query(`DELETE FROM team WHERE id = $1`, [team]);
      await pool.end();
    });

    it('sets it as the editor’s, hands it back with none, and audits both', async () => {
      const set = (colour: string) =>
        catalog([
          '--set-colour',
          '--team',
          externalId,
          '--colour',
          colour,
          '--reason',
          'T-1416 spec',
          '--by',
          email,
        ]);

      expect((await set('#DA291C')).code).toBe(0);
      expect(await colourOf()).toEqual({ colour: '#da291c', colour_source: 'editor' });
      // No match has a stored shirt, so the shirts know nothing.
      expect((await set('none')).code).toBe(0);
      expect(await colourOf()).toEqual({ colour: null, colour_source: null });

      const { rows } = await pool.query<{ reason: string; previous: unknown; next: unknown }>(
        `SELECT reason, previous, next FROM audit_log
          WHERE actor_id = $1 AND action = 'catalog.team_colour_set'
          ORDER BY created_at, id`,
        [admin],
      );
      expect(rows).toEqual([
        {
          reason: 'T-1416 spec',
          previous: { colour: null, colour_source: null },
          next: { colour: '#da291c', colour_source: 'editor' },
        },
        {
          reason: 'T-1416 spec',
          previous: { colour: '#da291c', colour_source: 'editor' },
          next: { colour: null, colour_source: null },
        },
      ]);
    });

    it('says so for a team nobody mapped', async () => {
      const out = await catalog([
        '--set-colour',
        '--team',
        'no-such-team',
        '--colour',
        '#000000',
        '--reason',
        'T-1416 spec',
      ]);
      expect(out.code).toBe(1);
    });
  },
);
