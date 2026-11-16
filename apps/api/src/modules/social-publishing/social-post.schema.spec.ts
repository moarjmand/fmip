import { randomUUID } from 'node:crypto';
import { type PoolClient, Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

/**
 * Social posts against the real schema (T-1834, D-427; review of PR #893):
 * what migration `1765901834000_social-post.sql` keeps by itself, before any
 * store exists. Everything runs in one transaction that is rolled back, so the
 * shared rows (`social_automation`, `social_switch`) and the posts, which are
 * never deleted, leave nothing behind. Each refusal runs in a savepoint.
 */
const DATABASE_URL = process.env.DATABASE_URL;

const PL_2025 = '00000000-0000-4000-8000-000000000302';
const REGULAR_SEASON = '00000000-0000-4000-8000-000000000401';
const RUN = `${Date.now().toString(36)}${process.pid.toString(36)}`.slice(-8);
const LONDON_TODAY = `(now() AT TIME ZONE 'Europe/London')::date`;

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'social posts in the database',
  () => {
    let pool: Pool;
    let db: PoolClient;
    const owner = randomUUID();
    const teammate = randomUUID();
    const fixtures = [randomUUID(), randomUUID()];
    let step = 0;

    const ok = async (sql: string, params: unknown[] = []): Promise<void> => {
      await db.query(sql, params);
    };
    async function refuses(sql: string, params: unknown[], pattern: RegExp): Promise<void> {
      step += 1;
      await db.query(`SAVEPOINT s${step}`);
      await expect(db.query(sql, params)).rejects.toThrow(pattern);
      await db.query(`ROLLBACK TO SAVEPOINT s${step}`);
    }

    const draft = (id: string, fixture: string, network: string, extra = ''): string =>
      `INSERT INTO social_post (id, fixture_id, kind, network, template_version, body, payload, inputs, gates, expires_at${extra === '' ? '' : ', state, approved_by_name, approved_at'})
     VALUES ('${id}', '${fixture}', 'result', '${network}', 'result@1', 'Full time', '{}', '{}', '{}', now() + interval '1 day'${extra})`;
    const level = (to: string, by: string | null, name: string, at: number, run = 14): string =>
      `UPDATE social_automation SET level = '${to}', clean_run = ${run},
       level_changed_at = now() + interval '${at} seconds',
       level_changed_by = ${by === null ? 'NULL' : `'${by}'`}, level_changed_by_name = '${name}',
       level_reason = 'step ${at}'
     WHERE kind = 'result'`;
    const claim = (id: string, slot: number): string =>
      `UPDATE social_post SET state = 'publishing', post_day = ${LONDON_TODAY}, slot = ${slot}, claimed_at = now() WHERE id = '${id}'`;
    const stop = (stopped: boolean, by: string): string =>
      `UPDATE social_switch SET stopped = ${stopped}, changed_at = now(), changed_by = '${by}', changed_by_name = 'x', reason = 'test'`;

    beforeAll(async () => {
      pool = new Pool({ connectionString: DATABASE_URL });
      db = await pool.connect();
      await db.query('BEGIN');
      await db.query(
        `INSERT INTO console_user (id, username, display_name, password_hash) VALUES
         ($1, $3, 'Owner', 'h'), ($2, $4, 'Teammate', 'h')`,
        [owner, teammate, `so${RUN}`, `st${RUN}`],
      );
      // A test database may already name its owner: this run's owner replaces it inside the transaction.
      await db.query(`UPDATE console_user SET owner = false WHERE owner`);
      await db.query(`UPDATE console_user SET owner = true WHERE id = $1`, [owner]);
      await db.query(
        `UPDATE social_switch SET stopped = false, changed_at = NULL, changed_by = NULL, changed_by_name = NULL, reason = NULL`,
      );
      for (const id of fixtures) {
        await db.query(
          `INSERT INTO fixture (id, season_id, stage_id, round, kickoff_at, status)
         VALUES ($1, $2, $3, 'Matchday', now() - interval '3 hours', 'finished')`,
          [id, PL_2025, REGULAR_SEASON],
        );
      }
    });

    afterAll(async () => {
      if (db !== undefined) {
        await db.query('ROLLBACK');
        db.release();
      }
      if (pool !== undefined) await pool.end();
    });

    it('raises a kind only by the owner, from 14, while publishing runs, with a change of its own', async () => {
      await refuses(level('automatic', teammate, 'T', 1), [], /only the console owner/);
      await refuses(level('automatic', owner, 'M', 1, 13), [], /14 clean posts/);
      await refuses(level('automatic', null, 'automation', 1), [], /only the console owner/);
      await refuses(
        level('automatic', owner, 'automation', 1),
        [],
        /social_automation_change_named/,
      );
      await ok(stop(true, teammate));
      await refuses(level('automatic', owner, 'M', 1), [], /while publishing is stopped/);
      await ok(stop(false, teammate)); // either account resumes
      await ok(level('automatic', owner, 'M', 1));
    });

    it('lets a rejection reset an automatic kind’s run (review finding 1)', async () => {
      await ok(`UPDATE social_automation SET clean_run = 0 WHERE kind = 'result'`);
      await ok(`UPDATE social_automation SET clean_run = 14 WHERE kind = 'result'`);
    });

    it('refuses a raise riding on the last change’s person and time (review finding 3)', async () => {
      await ok(level('approval', owner, 'M', 2));
      await refuses(
        `UPDATE social_automation SET level = 'automatic' WHERE kind = 'result'`,
        [],
        /records its own time/,
      );
      await refuses(
        `UPDATE social_automation SET level_reason = 'rewritten' WHERE kind = 'result'`,
        [],
        /only with a change of level/,
      );
      await ok(level('automatic', owner, 'M', 3));
      await refuses(level('approval', teammate, 'T', 4), [], /only the console owner/);
    });

    it('claims a post once and never changes it after publishing (review finding 2)', async () => {
      const id = randomUUID();
      await ok(draft(id, fixtures[0]!, 'x'));
      await ok(
        `UPDATE social_post SET state = 'approved', approved_by_name = 'automation', approved_at = now() WHERE id = $1`,
        [id],
      );
      await ok(claim(id, 1));
      await refuses(
        `UPDATE social_post SET state = 'publishing', post_day = ${LONDON_TODAY} + 1, slot = 2, claimed_at = now() + interval '1 day' WHERE id = $1`,
        [id],
        /not claimed again/,
      );
      await refuses(
        `UPDATE social_post SET state = 'publishing' WHERE id = $1`,
        [id],
        /not claimed again/,
      );
      await ok(
        `UPDATE social_post SET state = 'published', provider_ref = $2, published_at = now() WHERE id = $1`,
        [id, `ref-${RUN}`],
      );
      await refuses(
        `UPDATE social_post SET approved_by = $2, approved_by_name = 'Owner' WHERE id = $1`,
        [id, owner],
        /never changes/,
      );
      await refuses(`UPDATE social_post SET slot = 5 WHERE id = $1`, [id], /never changes/);
      await refuses(`DELETE FROM social_post WHERE id = $1`, [id], /never deleted/);
    });

    it('sends a refused post back to a person and stops the job retrying it once its kind is lowered (finding 5)', async () => {
      const id = randomUUID();
      await ok(draft(id, fixtures[0]!, 'instagram', `, 'approved', 'automation', now()`));
      await ok(claim(id, 1));
      await ok(
        `UPDATE social_post SET state = 'refused', post_day = NULL, slot = NULL, claimed_at = NULL, last_error = '429' WHERE id = $1`,
        [id],
      );
      await ok(level('approval', null, 'automation', 5, 0));
      await refuses(claim(id, 2), [], /automatic kind/);
      await refuses(
        `UPDATE social_post SET state = 'pending_approval' WHERE id = $1`,
        [id],
        /carries no approval/,
      );
      await refuses(
        `UPDATE social_post SET last_error = 'other' WHERE id = $1`,
        [id],
        /written with its state/,
      );
      await ok(
        `UPDATE social_post SET state = 'pending_approval', approved_by_name = NULL, approved_at = NULL WHERE id = $1`,
        [id],
      );
      await ok(
        `UPDATE social_post SET state = 'rejected', decided_by = $2, decided_by_name = 'Teammate', decided_at = now(), decided_reason = 'stale' WHERE id = $1`,
        [id, teammate],
      );
    });

    it('lets the job approve only an automatic kind (major 1)', async () => {
      await refuses(
        draft(randomUUID(), fixtures[1]!, 'instagram', `, 'approved', 'automation', now()`),
        [],
        /automatic kind/,
      );
    });

    it('keeps a person’s approval, the London day, the cap and the switch', async () => {
      const id = randomUUID();
      await ok(draft(id, fixtures[1]!, 'x'));
      await ok(
        `UPDATE social_post SET state = 'approved', approved_by = $2, approved_by_name = 'Teammate', approved_at = now() WHERE id = $1`,
        [id, teammate],
      );
      await refuses(
        `UPDATE social_post SET approved_at = now() + interval '1 hour' WHERE id = $1`,
        [id],
        /not rewritten/,
      );
      await refuses(
        `UPDATE social_post SET state = 'publishing', post_day = '2020-01-01', slot = 2, claimed_at = now() WHERE id = $1`,
        [id],
        /social_post_day_of_claim/,
      );
      await refuses(claim(id, 1), [], /social_post_daily_slot/);
      await refuses(claim(id, 6), [], /social_post_slot_range/);
      await ok(stop(true, owner));
      await refuses(claim(id, 2), [], /publishing is stopped/);
      await ok(
        `UPDATE social_post SET state = 'rejected', decided_by = $2, decided_by_name = 'Owner', decided_at = now(), decided_reason = 'changed mind' WHERE id = $1`,
        [id, owner],
      );
      await ok(stop(false, owner));
    });

    it('refuses images, a second live row, a second owner and a draft that skips the queue', async () => {
      const live = randomUUID();
      await ok(draft(live, fixtures[1]!, 'instagram'));
      await refuses(draft(randomUUID(), fixtures[1]!, 'instagram'), [], /social_post_one_live/);
      for (const payload of [
        '{"home":{"home_logo":"a.png"}}',
        '{"home":{"name":"https://x.test/a.png"}}',
      ]) {
        await refuses(
          `INSERT INTO social_post (fixture_id, kind, network, template_version, body, payload, inputs, gates, expires_at)
         VALUES ($1, 'result', 'x', 'result@1', 'x', $2, '{}', '{}', now())`,
          [fixtures[0], payload],
          /social_post_payload_no_image/,
        );
      }
      await refuses(
        `INSERT INTO social_post (fixture_id, kind, network, template_version, body, payload, inputs, gates, expires_at, state)
       VALUES ($1, 'result', 'x', 'result@1', 'x', '{}', '{}', '{}', now(), 'rejected')`,
        [fixtures[0]],
        /drafted waiting or approved/,
      );
      await refuses(
        `UPDATE console_user SET owner = true WHERE id = $1`,
        [teammate],
        /console_user_one_owner/,
      );
    });
  },
);
