import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiError,
  CareerPointsResponse,
  EligibilityResponse,
  LeaderboardResponse,
  RatingResponse,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { CareerPointsService } from './career-points.service';
import { eligibilityFor } from './internal/eligibility';
import { parseLeaderboardQuery } from './internal/leaderboard';
import { ReputationService } from './reputation.service';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NO_USER: ApiError = { error: 'not_found', message: 'No such member.' };

/**
 * Ratings over HTTP (T-053). A rating is public (blueprint 9.3: profiles and
 * leaderboards show it); recomputing one's own is a member action; the pass
 * over everyone is an operator action until the job runner (T-026) calls it.
 */
@Controller()
export class ReputationController {
  constructor(
    private readonly reputation: ReputationService,
    private readonly points: CareerPointsService,
    private readonly identity: IdentityService,
  ) {}

  @Get('me/rating')
  async mine(@Req() request: FastifyRequest): Promise<RatingResponse> {
    const user = await this.viewer(request);
    return { username: user.username, rating: await this.reputation.current(user.id) };
  }

  @Post('me/rating/recompute')
  @HttpCode(200)
  async recomputeMine(@Req() request: FastifyRequest): Promise<RatingResponse> {
    const user = await this.viewer(request);
    const outcome = await this.reputation.recompute(user.id);
    return {
      username: user.username,
      rating: outcome.kind === 'snapshot' || outcome.kind === 'unchanged' ? outcome.rating : null,
    };
  }

  @Get('users/:username/rating')
  async theirs(@Param('username') username: string): Promise<RatingResponse> {
    const user = await this.identity.userByUsername(username.toLowerCase());
    if (user === null) throw new NotFoundException(NO_USER);
    return { username: user.username, rating: await this.reputation.current(user.id) };
  }

  /** Public (blueprint 9.3). The minimum-sample filter has a floor; below it is a 400, not a bigger board. */
  @Get('leaderboard')
  async leaderboard(@Query() query: unknown): Promise<LeaderboardResponse> {
    const parsed = parseLeaderboardQuery(
      isRecord(query) ? query : {},
      this.reputation.leaderboardRules,
    );
    if (!parsed.ok) {
      const error: ApiError = {
        error: 'validation',
        message: 'The request is not valid.',
        fields: parsed.fields,
      };
      throw new BadRequestException(error);
    }
    return this.reputation.leaderboard(parsed.query);
  }

  @Get('me/points')
  async myPoints(@Req() request: FastifyRequest): Promise<CareerPointsResponse> {
    const user = await this.viewer(request);
    const points = await this.points.summary(user.id);
    if (points === null) throw new NotFoundException(NO_USER);
    return { username: user.username, points };
  }

  /** Writes whatever the member's settlements have earned and are not yet in the ledger. */
  @Post('me/points/award')
  @HttpCode(200)
  async awardMine(@Req() request: FastifyRequest): Promise<CareerPointsResponse> {
    const user = await this.viewer(request);
    const { added } = await this.points.award(user.id);
    const points = await this.points.summary(user.id);
    if (points === null) throw new NotFoundException(NO_USER);
    return { username: user.username, points, added };
  }

  @Get('users/:username/points')
  async theirPoints(@Param('username') username: string): Promise<CareerPointsResponse> {
    const user = await this.identity.userByUsername(username.toLowerCase());
    if (user === null) throw new NotFoundException(NO_USER);
    const points = await this.points.summary(user.id);
    if (points === null) throw new NotFoundException(NO_USER);
    return { username: user.username, points };
  }

  /** Blueprint 9.4: rating, sample and verified contact; never Career Points. */
  @Get('me/eligibility')
  async myEligibility(@Req() request: FastifyRequest): Promise<EligibilityResponse> {
    const user = await this.viewer(request);
    const rating = await this.reputation.current(user.id);
    return { username: user.username, eligibility: eligibilityFor(rating, user.email_verified) };
  }

  @Post('ratings/recompute')
  @HttpCode(200)
  async recomputeDue(
    @Req() request: FastifyRequest,
  ): Promise<{ users: number; snapshots: number }> {
    const user = await this.viewer(request);
    if (!(await this.identity.hasRole(user.id, 'admin'))) {
      const error: ApiError = {
        error: 'unauthenticated',
        message: 'Recomputing every rating needs the admin role.',
      };
      throw new ForbiddenException(error);
    }
    return this.reputation.recomputeDue();
  }

  private async viewer(request: FastifyRequest) {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return user;
  }
}
