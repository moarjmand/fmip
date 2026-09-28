import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  type ApiError,
  DATA_QUALITY_CHECKS,
  ROLE_REFUSALS,
  type DataQualityCheck,
  type DataQualityReport,
  type RefetchDataQualityResponse,
  type ReviewDataQualityBatchResponse,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { DataQualityService } from './data-quality.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const MAX_REASON = 500;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function reasonOf(body: unknown): string {
  const raw = (body as { reason?: unknown } | null)?.reason;
  return typeof raw === 'string' ? raw.trim() : '';
}

const REASON_FIELD = `Say why, in at most ${MAX_REASON} characters. This is recorded.`;

/**
 * The data-quality findings for administrators (T-821): `GET
 * /admin/data-quality` (each check's newest run, open findings per
 * competition and check, the open findings themselves) and `POST
 * /admin/data-quality/:id/review` (marks one reviewed, with a reason and an
 * audit row), and `POST /admin/data-quality/review-batch` (every open,
 * unreviewed finding of one check in one season, one reason, one audit row:
 * T-912), and `POST /admin/data-quality/refetch` (asks the feed again for one
 * fixture, or for every fixture behind one check's findings in a season,
 * audited: T-913, D-110). Admin role only. Reviewing corrects nothing: the finding stays
 * open until the data stops contradicting itself, and the watchdog stops
 * counting it.
 */
@Controller('admin/data-quality')
export class DataQualityController {
  constructor(
    private readonly dataQuality: DataQualityService,
    private readonly identity: IdentityService,
  ) {}

  private async admin(request: FastifyRequest): Promise<string> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin')))
      throw new ForbiddenException(ROLE_REFUSALS.administrator);
    return user.id;
  }

  @Get()
  async report(@Req() request: FastifyRequest): Promise<DataQualityReport> {
    await this.admin(request);
    return this.dataQuality.report(new Date());
  }

  /**
   * Queues a re-ask of the feed: `{ fixture_id, reason }` for one fixture, or
   * `{ check, season_id, reason }` for every fixture behind that check's open
   * findings in that season. The post-match job carries it within its share
   * of the day's budget; the finding resolves on the next sweep if the answer
   * agrees. 404: nothing the feed can be asked about. 409: all already waiting.
   */
  @Post('refetch')
  @HttpCode(202)
  async refetch(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<RefetchDataQualityResponse> {
    const actor = await this.admin(request);
    const raw = (body ?? {}) as { fixture_id?: unknown; check?: unknown; season_id?: unknown };
    const reason = reasonOf(body);
    const badReason = reason === '' || reason.length > MAX_REASON;
    const byFixture = raw.fixture_id !== undefined;
    const fixtureId =
      typeof raw.fixture_id === 'string' && UUID.test(raw.fixture_id) ? raw.fixture_id : null;
    const check = DATA_QUALITY_CHECKS.includes(raw.check as DataQualityCheck)
      ? (raw.check as DataQualityCheck)
      : null;
    const seasonId =
      typeof raw.season_id === 'string' && UUID.test(raw.season_id) ? raw.season_id : null;
    const fields: Record<string, string> = {
      ...(byFixture && fixtureId === null ? { fixture_id: 'A fixture id.' } : {}),
      ...(!byFixture && check === null
        ? { check: 'One of the data-quality checks, or a fixture_id instead.' }
        : {}),
      ...(!byFixture && seasonId === null ? { season_id: 'A season id.' } : {}),
      ...(badReason ? { reason: REASON_FIELD } : {}),
    };
    if (Object.keys(fields).length > 0) {
      throw new BadRequestException({
        error: 'validation',
        message: 'The request is not valid.',
        fields,
      } satisfies ApiError);
    }
    const outcome = await this.dataQuality.requestRefetch(
      byFixture ? { fixtureId: fixtureId! } : { check: check!, seasonId: seasonId! },
      actor,
      reason,
      new Date(),
    );
    if (outcome === null) {
      throw new NotFoundException({
        error: 'not_found',
        message: byFixture
          ? 'No fixture with that id that the feed can be asked about.'
          : 'No open finding of that check in that season names a fixture the feed can be asked about.',
      } satisfies ApiError);
    }
    if (outcome.queued.length === 0) {
      throw new ConflictException({
        error: 'conflict',
        message: 'The feed is already due to be asked again about all of these.',
      } satisfies ApiError);
    }
    return { queued: outcome.queued.length, already_queued: outcome.alreadyQueued };
  }

  @Post('review-batch')
  @HttpCode(200)
  async reviewBatch(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ReviewDataQualityBatchResponse> {
    const actor = await this.admin(request);
    const raw = (body ?? {}) as { check?: unknown; season_id?: unknown };
    const check = DATA_QUALITY_CHECKS.includes(raw.check as DataQualityCheck)
      ? (raw.check as DataQualityCheck)
      : null;
    const seasonId =
      typeof raw.season_id === 'string' && UUID.test(raw.season_id) ? raw.season_id : null;
    const reason = reasonOf(body);
    const badReason = reason === '' || reason.length > MAX_REASON;
    if (check === null || seasonId === null || badReason) {
      throw new BadRequestException({
        error: 'validation',
        message: 'The request is not valid.',
        fields: {
          ...(check === null ? { check: 'One of the data-quality checks.' } : {}),
          ...(seasonId === null ? { season_id: 'A season id.' } : {}),
          ...(badReason ? { reason: REASON_FIELD } : {}),
        },
      } satisfies ApiError);
    }
    const reviewed = await this.dataQuality.reviewBatch(check, seasonId, actor, reason, new Date());
    if (reviewed === 0) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'No open finding of that check in that season is waiting for review.',
      } satisfies ApiError);
    }
    return { reviewed };
  }

  @Post(':id/review')
  @HttpCode(200)
  async review(
    @Param('id') rawId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<{ reviewed: true }> {
    const actor = await this.admin(request);
    const id = /^[1-9][0-9]{0,15}$/.test(rawId) ? Number(rawId) : null;
    const reason = reasonOf(body);
    if (id === null || reason === '' || reason.length > MAX_REASON) {
      const error: ApiError = {
        error: 'validation',
        message: 'The request is not valid.',
        fields: {
          ...(id === null ? { id: 'A finding id.' } : {}),
          ...(reason === '' || reason.length > MAX_REASON ? { reason: REASON_FIELD } : {}),
        },
      };
      throw new BadRequestException(error);
    }
    const outcome = await this.dataQuality.review(id, actor, reason, new Date());
    if (outcome === 'not_found') {
      throw new NotFoundException({
        error: 'not_found',
        message: 'No open finding has that id; it may have resolved.',
      } satisfies ApiError);
    }
    if (outcome === 'already_reviewed') {
      throw new ConflictException({
        error: 'conflict',
        message: 'This finding has already been reviewed.',
      } satisfies ApiError);
    }
    return { reviewed: true };
  }
}
