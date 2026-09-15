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
import { GroupsService } from '../groups/groups.service';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { CareerPointsService } from './career-points.service';
import { ContributorService } from './contributor.service';
import { parseLeaderboardQuery } from './internal/leaderboard';
import { ReputationService } from './reputation.service';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NO_USER: ApiError = { error: 'not_found', message: 'No such member.' };
const NO_GROUP: ApiError = { error: 'not_found', message: 'No such group.' };

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
    private readonly groups: GroupsService,
    private readonly contributors: ContributorService,
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

  /**
   * A group's board (blueprint 8.2, T-243).
   *
   * **The same rating rules as the global board, scoped.** It is the method
   * above with one argument added, which is the whole design: same rules
   * version, same floor, same formula, same tiers, and the population narrowed
   * to the group's members. The minimum-prediction floor of D-037 applies
   * unchanged -- so a small group can have an empty board, and saying so is the
   * honest answer. Lowering the floor because a group is small is the second
   * formula this route exists to refuse.
   *
   * **It lives here rather than in the groups controller** because the ranking
   * is this boundary's and so is every rule behind it; groups answers only the
   * one question this boundary cannot -- who is in it, and may you ask.
   */
  @Get('groups/:slug/leaderboard')
  async groupLeaderboard(
    @Param('slug') slug: string,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ): Promise<LeaderboardResponse> {
    const viewer = await this.viewer(request);
    const parsed = parseLeaderboardQuery(
      isRecord(query) ? query : {},
      this.reputation.leaderboardRules,
    );
    if (!parsed.ok) {
      throw new BadRequestException({
        error: 'validation',
        message: 'The request is not valid.',
        fields: parsed.fields,
      } satisfies ApiError);
    }

    const audience = await this.groups.audience(viewer.id, slug);
    if (!audience.ok) {
      if (audience.reason === 'not_found') throw new NotFoundException(NO_GROUP);
      throw new ForbiddenException({
        error: 'validation',
        message: 'Who is in this group is shown to its members.',
      } satisfies ApiError);
    }
    return this.reputation.leaderboard(parsed.query, audience.members);
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

  /**
   * Blueprint 9.4's requirements, as this endpoint has always published them.
   *
   * T-250 added conduct to the same computation and moved it behind
   * `ContributorService`. This is now a **projection** of that one answer, not a
   * second one: `reasons` is the shortfall list flattened. A separate
   * computation here would be two answers to one question, which is exactly the
   * defect the contributor work exists to avoid. The fuller shape, with the
   * grant beside it, is `GET /me/contributor`.
   */
  @Get('me/eligibility')
  async myEligibility(@Req() request: FastifyRequest): Promise<EligibilityResponse> {
    const user = await this.viewer(request);
    const eligibility = await this.contributors.eligibilityOf(user.id);
    if (eligibility === null) throw new NotFoundException(NO_USER);
    return {
      username: user.username,
      eligibility: {
        eligible: eligibility.qualifies,
        reasons: eligibility.shortfalls.map((shortfall) => shortfall.message),
        rules_version: eligibility.rules_version,
      },
    };
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
