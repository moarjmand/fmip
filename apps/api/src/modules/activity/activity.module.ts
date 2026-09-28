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
import { ACTIVITY_MAX_DAYS, type ActivityReport, type ApiError } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityModule } from '../identity/identity.module';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { ActivityService } from './activity.service';
import { ActivityStore } from './internal/activity-store';
import { windowDays } from './internal/series';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_ADMIN: ApiError = {
  error: 'unauthenticated',
  message: 'The administration area needs the admin role.',
};

/**
 * `GET /admin/activity?days=` (T-807): how many registrations, sign-ins,
 * predictions, messages, notifications and the rest happened per UTC day over
 * the last `days` (30 by default, at most 90). Admin role only. Aggregates:
 * no member is named and no series is per member.
 */
@Controller('admin')
export class ActivityController {
  constructor(
    private readonly activity: ActivityService,
    private readonly identity: IdentityService,
  ) {}

  @Get('activity')
  async report(
    @Query('days') days: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ActivityReport> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin'))) throw new ForbiddenException(NOT_ADMIN);
    const window = windowDays(days);
    if (window === null) {
      const error: ApiError = {
        error: 'validation',
        message: 'The request is not valid.',
        fields: { days: `A whole number of days from 1 to ${String(ACTIVITY_MAX_DAYS)}.` },
      };
      throw new BadRequestException(error);
    }
    return this.activity.report(window, new Date());
  }
}

/**
 * Activity counts for the admin console (T-807, E80). Imports only identity,
 * for the admin gate; its SQL counts rows in tables other boundaries own and
 * writes nothing.
 */
@Module({
  imports: [IdentityModule],
  controllers: [ActivityController],
  providers: [ActivityService, ActivityStore],
  exports: [ActivityService],
})
export class ActivityModule {}
