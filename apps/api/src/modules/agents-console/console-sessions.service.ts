import { Inject, Injectable } from '@nestjs/common';
import type { ConsoleMe } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { hashToken, isWellFormedToken, parseCookies } from '../identity/identity.service';
import { CONSOLE_OPTIONS, type ConsoleOptions } from './agents-console.controller';
import { CONSOLE_COOKIE, consoleTokenText } from './internal/console-rules';
import { PostgresConsoleStore } from './internal/console-store';

/**
 * The console's session, for a read-only console page another module serves
 * (T-1729: the forecast model's page): the person behind the request's
 * `fmip_console` cookie, or null. The same check as the console's own routes
 * (`AgentsConsoleController.person`): a well-formed token whose keyed hash
 * names a live session of an enabled account.
 */
@Injectable()
export class ConsoleSessions {
  constructor(
    private readonly store: PostgresConsoleStore,
    @Inject(CONSOLE_OPTIONS) private readonly options: ConsoleOptions,
  ) {}

  async person(request: FastifyRequest): Promise<ConsoleMe | null> {
    const token = parseCookies(request.headers.cookie)[CONSOLE_COOKIE];
    if (!isWellFormedToken(token)) return null;
    return this.store.sessionUser(hashToken(consoleTokenText(token), this.options.secret));
  }
}
