import {
  Controller,
  ForbiddenException,
  Get,
  Module,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, RateLimitsReport } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityModule } from '../identity/identity.module';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { RateLimitsService } from './rate-limits.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_ADMIN: ApiError = {
  error: 'unauthenticated',
  message: 'The administration area needs the admin role.',
};

/**
 * `GET /admin/rate-limits` (T-811): every ceiling with its number as the
 * `rate_limit` table has it now, the writes it holds and its refusals per UTC
 * day for the last week, and every write without a ceiling with the reason.
 * Admin role only.
 */
@Controller('admin')
export class RateLimitsController {
  constructor(
    private readonly limits: RateLimitsService,
    private readonly identity: IdentityService,
  ) {}

  @Get('rate-limits')
  async report(@Req() request: FastifyRequest): Promise<RateLimitsReport> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin'))) throw new ForbiddenException(NOT_ADMIN);
    return this.limits.report(new Date());
  }
}

/**
 * The rate-limit boundary (T-811). Imports only identity (for the admin
 * gate), so the modules whose writes it limits in the API (briefings,
 * notifications) can import it without a cycle; `main.ts` takes the service
 * from the application for the response hook that counts a trigger's refusals.
 */
@Module({
  imports: [IdentityModule],
  controllers: [RateLimitsController],
  providers: [RateLimitsService],
  exports: [RateLimitsService],
})
export class RateLimitsModule {}
