import { Injectable } from '@nestjs/common';
import type { HealthReport } from '@fmip/contracts';

/**
 * Liveness only: it answers "this process is running and can serve HTTP".
 *
 * It deliberately reports nothing about Postgres or Redis. No client for either
 * exists yet, and a health endpoint that implied it had checked a dependency it
 * had not would be exactly the kind of invented value rule 3 forbids. Readiness
 * arrives with the database client in T-008.
 *
 * The response shape lives in `@fmip/contracts`, not here: it is the API's
 * contract with the web app, and both sides must break together when it moves.
 *
 * The clock is read directly rather than injected: Nest resolves constructor
 * parameters from their types, and a `Date` parameter makes it look for a `Date`
 * provider. Tests control time with fake timers instead.
 */
@Injectable()
export class HealthService {
  private readonly startedAt = new Date();

  report(): HealthReport {
    const now = new Date();

    return {
      status: 'ok',
      service: 'api',
      uptime_seconds: (now.getTime() - this.startedAt.getTime()) / 1000,
      started_at: this.startedAt.toISOString(),
      checked_at: now.toISOString(),
    };
  }
}
