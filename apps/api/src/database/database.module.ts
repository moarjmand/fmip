import { Global, Inject, Logger, Module, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';

/** Injection token for the shared `pg.Pool`. Modules ask for this, never for `Pool` by class. */
export const PG_POOL = Symbol('PG_POOL');

/**
 * Reads the connection string, refusing to guess.
 *
 * `pg` falls back to the libpq `PG*` environment variables when it is given no
 * connection string, which means a missing `DATABASE_URL` would connect to
 * whatever happens to be configured on the host and look healthy while doing
 * it. Failing here names the actual cause, the same way `API_PORT` does.
 */
export function databaseUrlFromEnv(env: NodeJS.ProcessEnv = process.env): string {
  const url = env.DATABASE_URL;

  if (url === undefined || url === '') {
    throw new Error(
      'DATABASE_URL is not set. The API needs a database; see .env.example and docs/03-project-map.md.',
    );
  }

  return url;
}

/**
 * The process's pool, which outlives a database restart (T-1435). When
 * Postgres stops or restarts it ends every idle connection ("terminating
 * connection due to administrator command"), and `pg` reports that as an
 * `error` event on the pool. An event emitter with no `error` listener throws,
 * so the whole API used to exit and lose whatever run it was in the middle
 * of. With the listener the broken client is simply dropped from the pool and
 * the next query opens a fresh connection; a query that was running at that
 * moment still fails on its own promise, as it should.
 */
export function createPool(connectionString: string, log = new Logger('Database')): Pool {
  const pool = new Pool({ connectionString });
  pool.on('error', (error: Error) => {
    log.warn('an idle database connection was closed; the pool will reconnect', {
      event: 'database.idle_client_error',
      error: error.message,
    });
  });
  return pool;
}

/**
 * One connection pool for the whole process (D-025: plain `pg`, hand-written
 * SQL, no ORM). Global so that every boundary module can inject `PG_POOL`
 * without importing this module itself. The pool is created lazily by `pg`:
 * nothing connects until the first query, so booting with an unreachable
 * database fails at the first request rather than at start-up, and `/health`
 * stays a liveness check.
 */
@Global()
@Module({
  providers: [
    {
      provide: PG_POOL,
      useFactory: (): Pool => createPool(databaseUrlFromEnv()),
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnApplicationShutdown {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  // Nest calls this on SIGTERM (enableShutdownHooks in main.ts). Draining the
  // pool lets in-flight queries finish instead of being cut off with the socket.
  // The last of Nest's shutdown hooks, not `onModuleDestroy`: a module's own
  // `beforeApplicationShutdown` may still write, as ingestion closes the runs
  // a stopping process leaves open (T-1468).
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
