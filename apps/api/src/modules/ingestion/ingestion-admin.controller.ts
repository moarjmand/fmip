import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { IngestionJobsService, type JobReport } from './ingestion-jobs.service';
import { PostgresRunStore } from './internal/run-store';

const MAX_REASON = 300;
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_AN_ADMIN: ApiError = {
  error: 'validation',
  message: 'This needs the administrator role.',
};

/**
 * `POST /admin/ingestion/backfill` (T-030): the season's fixtures from its
 * start, once.
 *
 * The scheduled job asks for a window around now, which is right for a
 * schedule and wrong for a deployment that has just been given a licence -- it
 * learns about this week and nothing before it, and the standings writer then
 * refuses the table because it disagrees with the matches we hold. This asks
 * for each current season's whole span instead.
 *
 * Administrator only, with a reason that is recorded (rule 10): it is a
 * deliberate act that spends the provider's quota and rewrites a season's
 * worth of rows. The run itself appears in `ingest_run` as a `fixtures` run
 * scoped `backfill`, so `/health/ingestion` and the admin page show it beside
 * every other run rather than in a place of its own.
 */
@Controller('admin')
export class IngestionAdminController {
  constructor(
    private readonly jobs: IngestionJobsService,
    private readonly runs: PostgresRunStore,
    private readonly identity: IdentityService,
  ) {}

  @Post('ingestion/backfill')
  @HttpCode(201)
  async backfill(
    @Body() body: { reason?: unknown },
    @Req() request: FastifyRequest,
  ): Promise<JobReport> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin'))) {
      throw new ForbiddenException(NOT_AN_ADMIN);
    }
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason === '') {
      throw new BadRequestException({
        error: 'validation',
        message: 'Say why this season is being backfilled. This is recorded.',
      } satisfies ApiError);
    }

    await this.runs.auditBackfill(user.id, reason.slice(0, MAX_REASON));
    return this.jobs.backfill();
  }
}
