import type { FastifyInstance } from 'fastify';
import { refusalCountedOnResponse } from './inventory';

/**
 * After every response: a 429 on a route held by one database-enforced
 * ceiling is that ceiling's refusal, counted for the day (T-811). The
 * trigger that refused it raised inside the request's transaction, so its
 * own count was rolled back with everything else; this is the only place
 * left that sees it. The API-enforced ceilings count their refusals where
 * they decide them, so they are not counted twice here.
 */
export function registerRefusalCounter(
  fastify: FastifyInstance,
  limits: { recordRefusal(action: string): Promise<void> },
): void {
  fastify.addHook('onResponse', (request, reply, done) => {
    if (reply.statusCode === 429) {
      const action = refusalCountedOnResponse(request.method, request.routeOptions.url);
      if (action !== null) void limits.recordRefusal(action);
    }
    done();
  });
}
