import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * `catalog.mjs --adopt-national` against the real schema (T-1332, D-179): a
 * team queued from an international competition is offered as a national
 * team, adopted with the country the operator states, and a team queued from
 * a club competition is refused. Only the ids this file queues are touched:
 * `--adopt-teams` would adopt every pending club in a shared database, so it
 * is not run here.
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
  if (input !== undefined) {
    child.child.stdin?.end(input);
  }
  try {
    const { stdout, stderr } = await child;
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code: number; stdout: string; stderr: string };
    return { code: e.code, stdout: e.stdout, stderr: e.stderr };
  }
}

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'adopting national teams',
  () => {
    let pool: pg.Pool;
    const international = randomUUID();
    const continental = randomUUID();
    // Numeric, as the provider's are, and far from any real id.
    const base = 900_000_000 + Math.floor(Math.random() * 90_000_000);
    const nationalId = String(base);
    const clubId = String(base + 1);
    let countryCode = '';

    beforeAll(async () => {
      pool = new pg.Pool({ connectionString: DATABASE_URL });
      const { rows } = await pool.query<{ code: string }>(
        `SELECT c.code FROM country c
        WHERE NOT EXISTS (SELECT 1 FROM team t WHERE t.country_id = c.id AND t.kind = 'national')
        ORDER BY c.code LIMIT 1`,
      );
      countryCode = rows[0]?.code ?? '';
      expect(countryCode, 'a country with no national team').not.toBe('');
      await pool.query(
        `INSERT INTO competition (id, name, kind, scope, gender, age_group, is_active)
       VALUES ($1, 'T-1332 friendlies', 'friendly', 'international', 'men', 'senior', true),
              ($2, 'T-1332 club cup', 'cup', 'continental', 'men', 'senior', true)`,
        [international, continental],
      );
      await pool.query(
        `INSERT INTO unresolved_entity (provider, entity_type, external_id, payload)
       VALUES ('api_football', 'team', $1, $2::jsonb), ('api_football', 'team', $3, $4::jsonb)`,
        [
          nationalId,
          JSON.stringify({ externalId: nationalId, name: 'T-1332 Nation', seenIn: international }),
          clubId,
          JSON.stringify({ externalId: clubId, name: 'T-1332 Club', seenIn: continental }),
        ],
      );
    });

    afterAll(async () => {
      if (pool === undefined) return;
      const ids = [nationalId, clubId];
      const { rows } = await pool.query<{ internal_id: string }>(
        `DELETE FROM provider_mapping
        WHERE provider = 'api_football' AND entity_type = 'team' AND external_id = ANY($1)
        RETURNING internal_id`,
        [ids],
      );
      await pool.query(`DELETE FROM team WHERE id = ANY($1::uuid[])`, [
        rows.map((r) => r.internal_id),
      ]);
      await pool.query(
        `DELETE FROM unresolved_entity
        WHERE provider = 'api_football' AND entity_type = 'team' AND external_id = ANY($1)`,
        [ids],
      );
      await pool.query(`DELETE FROM competition WHERE id = ANY($1::uuid[])`, [
        [international, continental],
      ]);
      await pool.end();
    });

    it('lists the national team to fill in, and not the club', async () => {
      const { code, stdout } = await catalog(['--adopt-national', '--dry-run']);
      expect(code).toBe(0);
      expect(stdout).toContain('provider_team_id,country_code,name');
      expect(stdout).toContain(`${nationalId},,T-1332 Nation`);
      expect(stdout).not.toContain(clubId);
    });

    it('adopts the national team with its country, and refuses the club', async () => {
      const list = [
        'provider_team_id,country_code,name',
        `${nationalId},${countryCode},`,
        `${clubId},IRN,`,
      ];
      const { code, stdout } = await catalog(['--adopt-national', '--file', '-'], list.join('\n'));
      expect(code).toBe(1);
      expect(stdout).toContain('1 national team(s) adopted.');
      expect(stdout).toContain(`not adopted: ${clubId}: not a national team waiting in the queue`);

      const { rows } = await pool.query<{ name: string; kind: string; code: string }>(
        `SELECT t.name, t.kind, c.code FROM provider_mapping pm
         JOIN team t ON t.id = pm.internal_id
         JOIN country c ON c.id = t.country_id
        WHERE pm.provider = 'api_football' AND pm.entity_type = 'team' AND pm.external_id = $1`,
        [nationalId],
      );
      expect(rows).toEqual([{ name: 'T-1332 Nation', kind: 'national', code: countryCode }]);
      const club = await pool.query<{ status: string }>(
        `SELECT status FROM unresolved_entity
        WHERE provider = 'api_football' AND entity_type = 'team' AND external_id = $1`,
        [clubId],
      );
      expect(club.rows).toEqual([{ status: 'pending' }]);
    });

    it('refuses a second national team for the same country', async () => {
      await pool.query(
        `UPDATE unresolved_entity SET payload = payload || jsonb_build_object('seenIn', $2::text)
        WHERE provider = 'api_football' AND entity_type = 'team' AND external_id = $1`,
        [clubId, international],
      );
      const list = ['provider_team_id,country_code', `${clubId},${countryCode}`];
      const { code, stdout } = await catalog(['--adopt-national', '--file', '-'], list.join('\n'));
      expect(code).toBe(1);
      expect(stdout).toContain(`${countryCode} already has a national team`);
    });
  },
);
