import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  type ApiError,
  RATING_THRESHOLD_MAX_LEAD_DAYS,
  ROLE_REFUSALS,
  type RatingThresholdListResponse,
  type RatingThresholdVersion,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { parseRequest } from './internal/thresholds';
import { RatingThresholdsService } from './rating-thresholds.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };

function validation(message: string, fields?: Record<string, string>): BadRequestException {
  return new BadRequestException({
    error: 'validation',
    message,
    ...(fields === undefined ? {} : { fields }),
  } satisfies ApiError);
}

/**
 * Rating thresholds in the console (T-1160, D-152, D-164), administrators
 * only. `GET /admin/rating-thresholds` is every version and the one in force;
 * `POST /admin/rating-thresholds` records a new version with all six values,
 * a reason and a start (now when omitted, never in the past), with an
 * `audit_log` row carrying the version it supersedes (rule 10). Nothing is
 * edited, and the formula is not here: it changes only by a new version in
 * code with its own decision.
 */
@Controller('admin/rating-thresholds')
export class RatingThresholdsController {
  constructor(
    private readonly thresholds: RatingThresholdsService,
    private readonly identity: IdentityService,
  ) {}

  @Get()
  async list(@Req() request: FastifyRequest): Promise<RatingThresholdListResponse> {
    await this.administrator(request);
    return this.thresholds.list();
  }

  @Post()
  @HttpCode(201)
  async supersede(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<RatingThresholdVersion> {
    const actor = await this.administrator(request);
    const parsed = parseRequest(body);
    if (!parsed.ok) throw validation(parsed.message, parsed.fields);
    const outcome = await this.thresholds.supersede(
      parsed.values,
      parsed.effectiveFrom,
      actor.id,
      parsed.reason,
    );
    switch (outcome.kind) {
      case 'recorded':
        return outcome.version;
      case 'past':
        throw validation(
          'A start in the past would change what earlier ratings were computed under.',
          { effective_from: 'Now or later; empty means now.' },
        );
      case 'too_far':
        throw validation(`A start at most ${RATING_THRESHOLD_MAX_LEAD_DAYS} days ahead.`, {
          effective_from: `At most ${RATING_THRESHOLD_MAX_LEAD_DAYS} days ahead.`,
        });
      case 'unchanged':
        throw validation(
          `These are the values of version ${outcome.version}, in force at that start: nothing would change.`,
        );
    }
  }

  private async administrator(request: FastifyRequest) {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin')))
      throw new ForbiddenException(ROLE_REFUSALS.administrator);
    return user;
  }
}
