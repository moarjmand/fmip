import { Controller, ForbiddenException, Get, Req, UnauthorizedException } from '@nestjs/common';
import type { AdminAlertsReport, ApiError, WatchdogReport } from '@fmip/contracts';
import { ROLE_REFUSALS } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { AdminAlertsService } from './admin-alerts.service';
import { WatchdogService } from './watchdog.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };

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
    private readonly alerts: AdminAlertsService,
  ) {}

  private async admin(request: FastifyRequest): Promise<void> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin')))
      throw new ForbiddenException(ROLE_REFUSALS.administrator);
  }

  @Get('watchdog')
  async report(@Req() request: FastifyRequest): Promise<WatchdogReport> {
    await this.admin(request);
    return this.watchdog.report(new Date());
  }

  /**
   * `GET /admin/health/alerts` (T-802): which channels carry the alerts, how
   * many administrators they are written for, the cursor, and where each
   * recent alert went -- so a deployment whose only channel is the inbox says
   * so, and nothing reads "sent" that was not.
   */
  @Get('alerts')
  async alertsReport(@Req() request: FastifyRequest): Promise<AdminAlertsReport> {
    await this.admin(request);
    return this.alerts.report(new Date());
  }
}
