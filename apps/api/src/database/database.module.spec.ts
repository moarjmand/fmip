import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createPool, databaseUrlFromEnv } from './database.module';

const DATABASE_URL = process.env.DATABASE_URL;

describe('databaseUrlFromEnv', () => {
  it('refuses to guess when DATABASE_URL is missing', () => {
    expect(() => databaseUrlFromEnv({})).toThrow(/DATABASE_URL is not set/);
    expect(databaseUrlFromEnv({ DATABASE_URL: 'postgres://x/y' })).toBe('postgres://x/y');
  });
});

describe.skipIf(DATABASE_URL === undefined || DATABASE_URL === '')(
  'the pool across a database restart (T-1435)',
  () => {
    const warn = vi.fn();
    let pool: Pool;
    let admin: Pool;

    beforeAll(() => {
      pool = createPool(DATABASE_URL as string, { warn } as never);
      admin = new Pool({ connectionString: DATABASE_URL, max: 1 });
    });

    afterAll(async () => {
      await pool.end();
      await admin.end();
    });

    it('drops an idle connection the server ends, logs it, and keeps answering', async () => {
      // One idle connection in the pool, and its backend's pid.
      const { rows } = await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      const pid = rows[0]?.pid;
      expect(pid).toBeTypeOf('number');
      expect(pool.idleCount).toBe(1);

      // What a restart does to every idle connection. The test adds no listener
      // of its own: without createPool's, this emit throws an unhandled error.
      await admin.query('SELECT pg_terminate_backend($1)', [pid]);
      await vi.waitFor(() =>
        expect(warn).toHaveBeenCalledWith(
          'an idle database connection was closed; the pool will reconnect',
          expect.objectContaining({ event: 'database.idle_client_error' }),
        ),
      );
      expect(pool.idleCount).toBe(0);
      const again = await pool.query<{ pid: number }>('SELECT pg_backend_pid() AS pid');
      expect(again.rows[0]?.pid).not.toBe(pid);
    });
  },
);
