import { randomUUID } from 'node:crypto';
import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { ApiError } from '@fmip/contracts';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { JsonLogger } from './json-logger';

/**
 * Tracing and error tracking over HTTP (T-071, D-044).
 *
 * Every request carries an id: the caller's `x-request-id` when it sends
 * one (the web app does, per page render), else a fresh UUID. The id is on
 * the response, in every access-log line and in every error record, so a
 * failure a member reports can be found in the log by the id on their page.
 */
export const REQUEST_ID_HEADER = 'x-request-id';

/** Fastify's `genReqId`: the caller's id when it is sane, else a UUID. */
export function requestIdFrom(header: string | string[] | undefined): string {
  const raw = Array.isArray(header) ? header[0] : header;
  return raw !== undefined && /^[A-Za-z0-9._-]{8,128}$/.test(raw) ? raw : randomUUID();
}

/** Access log after every response, with method, route, status, duration and the id. */
export function registerAccessLog(fastify: FastifyInstance, logger: JsonLogger): void {
  fastify.addHook('onRequest', (request, reply, done) => {
    void reply.header(REQUEST_ID_HEADER, request.id);
    done();
  });
  fastify.addHook('onResponse', (request, reply, done) => {
    const status = reply.statusCode;
    logger.event(status >= 500 ? 'error' : 'log', 'Http', `${request.method} ${request.url}`, {
      event: 'http.request',
      request_id: request.id,
      method: request.method,
      url: request.url,
      status,
      duration_ms: Math.round(reply.elapsedTime),
    });
    done();
  });
}

/**
 * The one place unhandled errors become responses. An `HttpException` keeps
 * its own body (the boundaries already answer with `ApiError`); anything
 * else is a 500 with the request id, and the stack goes to the log, never to
 * the client.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: JsonLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      if (status >= 500) {
        this.logger.event('error', 'Http', 'request failed', {
          event: 'http.error',
          request_id: request.id,
          status,
          err: { name: exception.name, message: exception.message, stack: exception.stack },
        });
      }
      void reply.status(status).send(typeof body === 'string' ? { message: body } : body);
      return;
    }

    const error = exception instanceof Error ? exception : new Error(String(exception));
    this.logger.event('error', 'Http', 'unhandled error', {
      event: 'http.error',
      request_id: request.id,
      method: request.method,
      url: request.url,
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      err: { name: error.name, message: error.message, stack: error.stack },
    });
    const body: ApiError = {
      error: 'internal',
      message: 'Something went wrong on our side. Quote the request id when reporting it.',
      request_id: request.id,
    };
    void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send(body);
  }
}
