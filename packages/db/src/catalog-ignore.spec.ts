import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * `catalog.mjs --ignore` and `--unignore` against the real schema (T-1338):
 * pending ids set aside with who and why, a resolved one left alone, the
 * waiting national sides selected by the scope they were seen in, every row
 * audited, and the decision undone. Only the ids this file queues are named:
 * `--waiting-international` reaches every such team in a shared database, so
 * it is run here as a dry run alone.
 */
const DATABASE_URL = process.env.DATABASE_URL;
const SCRIPT = join(__dirname, '..', 'scripts', 'catalog.mjs');
const run = promisify(execFile);

async function catalog(
  args: string[],
  input?: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const child = run(process.execPath, [SCRIPT, ...args], {
    env: { ...process.env, DATABASE_URL },
  });
  child.child.stdin?.end(input ?? '');
  try {
    const { stdout, stderr } = await child;
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'setting queued ids aside',
  () => {
    let pool: pg.Pool;
    const admin = randomUUID();
    const email = `t1338-${admin}@example.test`;
    const international = randomUUID();
    const domestic = randomUUID();
    const club = randomUUID();
    // Numeric, as the provider's are, and far from any real id.
    const base = 910_000_000 + Math.floor(Math.random() * 80_000_000);
    const youth = String(base);
    const women = String(base + 1);
    const resolved = String(base + 2);
    const domesticClub = String(base + 3);
    const ids = [youth, women, resolved, domesticClub];

    async function statusOf(externalId: string) {
      const { rows } = await pool.query<{
        status: string;
        resolved_by: string | null;
        resolution_note: string | null;
      }>(
        `SELECT status, resolved_by, resolution_note FROM unresolved_entity
        WHERE provider = 'api_football' AND entity_type = 'team' AND external_id = $1`,
        [externalId],
      );
      return rows[0];
    }

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: DATABASE_URL });
      const country = await pool.query<{ id: string }>(`SELECT id FROM country LIMIT 1`);
      await pool.query(
        `INSERT INTO user_account
         (id, username, display_name, email, country_id, preferred_language, timezone,
          accepted_rules_at, status)
       VALUES ($1, $2, 'T-1338 admin', $3, $4, 'en', 'UTC', now(), 'active')`,
        [admin, `t1338_${admin.slice(0, 8)}`, email, country.rows[0]?.id],
      );
      await pool.query(
        `INSERT INTO competition (id, name, kind, scope, gender, age_group, is_active, country_id)
       VALUES ($1, 'T-1338 friendlies', 'friendly', 'international', 'men', 'senior', true, NULL),
              ($2, 'T-1338 league', 'league', 'domestic', 'men', 'senior', true, $3)`,
        [international, domestic, country.rows[0]?.id],
      );
      await pool.query(
        `INSERT INTO team (id, name, kind, gender) VALUES ($1, 'T-1338 FC', 'club', 'men')`,
        [club],
      );
      const queue = (externalId: string, name: string, seenIn: string) => [
        externalId,
        JSON.stringify({ externalId, name, seenIn }),
      ];
      await pool.query(
        `INSERT INTO unresolved_entity (provider, entity_type, external_id, payload)
       VALUES ('api_football', 'team', $1, $2::jsonb), ('api_football', 'team', $3, $4::jsonb),
              ('api_football', 'team', $5, $6::jsonb), ('api_football', 'team', $7, $8::jsonb)`,
        [
          ...queue(youth, 'T-1338 U23', international),
          ...queue(women, 'T-1338 W', international),
          ...queue(resolved, 'T-1338 FC', international),
          ...queue(domesticClub, 'T-1338 Town', domestic),
        ],
      );
      await pool.query(
        `UPDATE unresolved_entity
          SET status = 'resolved', resolved_internal_id = $2, resolved_by = 'spec', resolved_at = now()
        WHERE provider = 'api_football' AND entity_type = 'team' AND external_id = $1`,
        [resolved, club],
      );
    });

    afterAll(async () => {
      if (pool === undefined) return;
      // The audit log refuses a delete by trigger; a test's own rows go with
      // the triggers off, as `apps/api/src/testing/cleanup.ts` does it.
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
        `DELETE FROM unresolved_entity
        WHERE provider = 'api_football' AND entity_type = 'team' AND external_id = ANY($1)`,
        [ids],
      );
      await pool.query(`DELETE FROM team WHERE id = $1`, [club]);
      await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [
        [international, domestic],
      ]);
      await pool.end();
    });

    it('offers the teams waiting from international competitions, and not the club', async () => {
      const { code, stdout } = await catalog([
        '--ignore',
        '--type',
        'team',
        '--waiting-international',
        '--dry-run',
      ]);
      expect(code).toBe(0);
      expect(stdout).toContain(`${youth}  T-1338 U23`);
      expect(stdout).toContain(`${women}  T-1338 W`);
      expect(stdout).not.toContain(domesticClub);
      expect(stdout).not.toContain(`${resolved}  `);
      expect((await statusOf(youth))?.status).toBe('pending');
    });

    it('refuses an administrator it does not know, and writes nothing', async () => {
      const { code, stderr } = await catalog(
        [
          '--ignore',
          '--type',
          'team',
          '--file',
          '-',
          '--by',
          'nobody@example.test',
          '--reason',
          'x',
        ],
        youth,
      );
      expect(code).toBe(1);
      expect(stderr).toContain('No account with the e-mail nobody@example.test');
      expect((await statusOf(youth))?.status).toBe('pending');
    });

    it('sets the pending ids aside with who and why, audits each, and leaves a resolved one', async () => {
      const list = ['provider_id,name', '# not senior men', `${youth},U23`, women, resolved, '1'];
      const { code, stdout } = await catalog(
        [
          '--ignore',
          '--type',
          'team',
          '--file',
          '-',
          '--by',
          email,
          '--reason',
          'youth and women sides of the friendlies',
        ],
        list.join('\n'),
      );
      expect(code).toBe(0);
      expect(stdout).toContain('2 team(s) set aside, each audited.');
      expect(stdout).toContain(`not touched: ${resolved} (T-1338 FC): resolved, left as it is`);
      expect(stdout).toContain('not touched: 1: not in the queue');

      expect(await statusOf(youth)).toEqual({
        status: 'ignored',
        resolved_by: email,
        resolution_note: 'youth and women sides of the friendlies',
      });
      expect((await statusOf(resolved))?.status).toBe('resolved');
      expect((await statusOf(domesticClub))?.status).toBe('pending');

      const audit = await pool.query<{ action: string; reason: string; previous: unknown }>(
        `SELECT action, reason, previous FROM audit_log WHERE actor_id = $1 ORDER BY created_at`,
        [admin],
      );
      expect(audit.rows).toEqual([
        {
          action: 'catalog.entity_ignored',
          reason: 'youth and women sides of the friendlies',
          previous: { status: 'pending' },
        },
        {
          action: 'catalog.entity_ignored',
          reason: 'youth and women sides of the friendlies',
          previous: { status: 'pending' },
        },
      ]);
    });

    it('puts an ignored id back in the queue, audited, and leaves a pending one', async () => {
      const { code, stdout } = await catalog(
        [
          '--unignore',
          '--type',
          'team',
          '--file',
          '-',
          '--by',
          email,
          '--reason',
          'it is the senior side after all',
        ],
        `${women}\n${domesticClub}`,
      );
      expect(code).toBe(0);
      expect(stdout).toContain('1 team(s) put back in the queue, each audited.');
      expect(stdout).toContain(
        `not touched: ${domesticClub} (T-1338 Town): pending, left as it is`,
      );
      expect(await statusOf(women)).toEqual({
        status: 'pending',
        resolved_by: null,
        resolution_note: null,
      });
      expect((await statusOf(youth))?.status).toBe('ignored');

      const undo = await pool.query<{ action: string; previous: { status: string } }>(
        `SELECT action, previous FROM audit_log
        WHERE actor_id = $1 AND action = 'catalog.entity_unignored'`,
        [admin],
      );
      expect(undo.rows).toEqual([
        {
          action: 'catalog.entity_unignored',
          previous: {
            status: 'ignored',
            resolved_by: email,
            note: 'youth and women sides of the friendlies',
          },
        },
      ]);
    });
  },
);
