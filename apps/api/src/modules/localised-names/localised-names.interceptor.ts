import {
  Injectable,
  type CallHandler,
  type ExecutionContext,
  type NestInterceptor,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { from, mergeMap, type Observable } from 'rxjs';
import { LocalisedNamesService, localeOf } from './localised-names.service';

/**
 * `?locale=` on every read (T-1312). Registered once for the whole API, so an
 * endpoint that names a team, a competition or a country answers in the
 * reader's language without each store carrying its own copy of the lookup,
 * and a new endpoint cannot forget it.
 *
 * Reads only (`GET`), and only answers the handler returned: the console's
 * writes are untouched, and a stream (which answers through the raw reply)
 * localises its own snapshots, per locale.
 */
@Injectable()
export class LocalisedNamesInterceptor implements NestInterceptor {
  constructor(private readonly names: LocalisedNamesService) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    if (context.getType() !== 'http') return next.handle();
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (request.method !== 'GET') return next.handle();
    const query = request.query as Record<string, unknown> | undefined;
    const locale = localeOf(query?.locale);
    if (locale === null) return next.handle();
    return next.handle().pipe(mergeMap((body: unknown) => from(this.names.localise(body, locale))));
  }
}
