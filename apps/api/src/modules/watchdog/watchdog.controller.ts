import { Controller, ForbiddenException, Get, Req, UnauthorizedException } from '@nestjs/common';
import type { ApiError, WatchdogReport } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { WatchdogService } from './watchdog.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_ADMIN: ApiError = {
  error: 'unauthenticated',
  message: 'The administration area needs the admin role.',
};

/**
 * `GET /admin/health/watchdog` (T-801): every condition with its threshold
 * and state, and the newest transitions. Admin role only: unlike the public
 * `/health/*` views it names what is wrong and since when, which is the
 * operator's business, not a visitor's.
 */
@Controller('admin/health')
export class WatchdogController {
  constructor(
    private readonly watchdog: WatchdogService,
    private readonly identity: IdentityService,
  ) {}

  @Get('watchdog')
  async report(@Req() request: FastifyRequest): Promise<WatchdogReport> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin'))) throw new ForbiddenException(NOT_ADMIN);
    return this.watchdog.report(new Date());
  }
}
