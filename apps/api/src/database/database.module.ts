import { Global, Inject, Module, type OnModuleDestroy } from '@nestjs/common';
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
      useFactory: (): Pool => new Pool({ connectionString: databaseUrlFromEnv() }),
    },
  ],
  exports: [PG_POOL],
})
export class DatabaseModule implements OnModuleDestroy {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  // Nest calls this on SIGTERM (enableShutdownHooks in main.ts). Draining the
  // pool lets in-flight queries finish instead of being cut off with the socket.
  async onModuleDestroy(): Promise<void> {
    await this.pool.end();
  }
}
