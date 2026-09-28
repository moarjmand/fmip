import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { HTTP_APP_OPTIONS } from './http-options';
import { FailureCountsService } from './modules/failure-counts/failure-counts.service';
import {
  AllExceptionsFilter,
  registerAccessLog,
  requestIdFrom,
} from './observability/http-observability';
import { JsonLogger } from './observability/json-logger';
import { RateLimitsService } from './modules/rate-limits/rate-limits.service';
import { registerRefusalCounter } from './modules/rate-limits/refusal-counter';

const DEFAULT_PORT = 3001;

export function resolvePort(raw: string | undefined): number {
  if (raw === undefined || raw === '') {
    return DEFAULT_PORT;
  }

  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    // Falling back to the default here would start a server on a port nobody
    // is pointing at, which looks healthy and serves no one.
    throw new Error(`API_PORT must be an integer between 1 and 65535, received: ${raw}`);
  }

  return port;
}

async function bootstrap(): Promise<void> {
  // Structured logs, request ids and one error filter (T-071, D-044).
  const logger = new JsonLogger();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      genReqId: (request: { headers: Record<string, string | string[] | undefined> }) =>
        requestIdFrom(request.headers['x-request-id']),
    }),
    { ...HTTP_APP_OPTIONS, logger },
  );
  // Every 5xx is also counted per route and hour (T-803).
  const failures = app.get(FailureCountsService);
  registerAccessLog(app.getHttpAdapter().getInstance(), logger, (seen) => {
    void failures.recordHttpError(seen);
  });
  // A refusal by a database-enforced ceiling is counted per day here, because
  // the trigger that refused it rolled its own count back (T-811).
  registerRefusalCounter(app.getHttpAdapter().getInstance(), app.get(RateLimitsService));
  app.useGlobalFilters(new AllExceptionsFilter(logger));

  // Lets Nest run its shutdown hooks on SIGTERM, which is how Docker stops a
  // container. Without this, in-flight requests are cut off.
  app.enableShutdownHooks();

  // 0.0.0.0 rather than the default loopback: inside a container, loopback is
  // not reachable from the host or from sibling services.
  await app.listen({ port: resolvePort(process.env.API_PORT), host: '0.0.0.0' });
}

// istanbul ignore next -- entry point, exercised by running the process
if (require.main === module) {
  void bootstrap();
}
