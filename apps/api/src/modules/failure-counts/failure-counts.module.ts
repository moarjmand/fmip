import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Module,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, FailureCountsReport } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityModule } from '../identity/identity.module';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { FailureCountsService } from './failure-counts.service';
import { FailureCountsStore } from './internal/failure-counts-store';
import { MAX_WINDOW_HOURS, windowHours } from './internal/summarise';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_ADMIN: ApiError = {
  error: 'unauthenticated',
  message: 'The administration area needs the admin role.',
};

/**
 * `GET /admin/health/failures?hours=` (T-803): 5xx responses per route and
 * failed jobs per queue over the last `hours` (24 by default, at most the
 * thirty days kept). Admin role only: routes, statuses and request ids are
 * the operator's business.
 */
@Controller('admin/health')
export class FailureCountsController {
  constructor(
    private readonly failures: FailureCountsService,
    private readonly identity: IdentityService,
  ) {}

  @Get('failures')
  async report(
    @Query('hours') hours: unknown,
    @Req() request: FastifyRequest,
  ): Promise<FailureCountsReport> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin'))) throw new ForbiddenException(NOT_ADMIN);
    const window = windowHours(hours);
    if (window === null) {
      const error: ApiError = {
        error: 'validation',
        message: 'The request is not valid.',
        fields: { hours: `A whole number of hours from 1 to ${MAX_WINDOW_HOURS}.` },
      };
      throw new BadRequestException(error);
    }
    return this.failures.report(window, new Date());
  }
}

/**
 * The failure counts boundary (T-803). Imports only identity (for the admin
 * gate), so the ingestion, news and channel-post modules can import it to
 * count their workers' failures without a cycle; `main.ts` takes the service
 * from the application for the access log's 5xx hook.
 */
@Module({
  imports: [IdentityModule],
  controllers: [FailureCountsController],
  providers: [FailureCountsService, FailureCountsStore],
  exports: [FailureCountsService],
})
export class FailureCountsModule {}
