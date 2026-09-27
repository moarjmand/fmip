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
  RatingHistoryResponse,
  RatingResponse,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { GroupsService } from '../groups/groups.service';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { ProfileService } from '../profile/profile.service';
import { SocialService } from '../social/social.service';
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
    private readonly profiles: ProfileService,
    private readonly social: SocialService,
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

  @Get('me/rating/history')
  async myHistory(@Req() request: FastifyRequest): Promise<RatingHistoryResponse> {
    const user = await this.viewer(request);
    return {
      kind: 'visible',
      username: user.username,
      is_self: true,
      history: await this.reputation.history(user.id),
    };
  }

  /**
   * The rating over time and by competition (blueprint 9.3, T-640). Unlike the
   * current rating it says when and where the member predicted, so it follows
   * `prediction_history_visibility`, asked of the profile boundary exactly as
   * `GET /users/:username/predictions` asks it: a viewer who may not see the
   * history gets the restricted shape, not a thinner trajectory.
   */
  @Get('users/:username/rating/history')
  async theirHistory(
    @Param('username') username: string,
    @Req() request: FastifyRequest,
  ): Promise<RatingHistoryResponse> {
    const viewer = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    const access = await this.profiles.predictionHistoryAccess(username, viewer?.id ?? null);
    if (access.kind === 'unknown') throw new NotFoundException(NO_USER);
    if (access.kind === 'restricted')
      return { kind: 'restricted', username: access.username, visibility: access.visibility };
    return {
      kind: 'visible',
      username: access.username,
      is_self: access.isSelf,
      history: await this.reputation.history(access.userId),
    };
  }

  /**
   * Public (blueprint 9.3). The minimum-sample filter has a floor; below it is a 400, not a bigger board.
   *
   * T-641: `scope=friends` is the viewer and their accepted friends, and needs
   * a session (401 without one: there is no one to be friends with);
   * `period=month|season` rates each member over that period's settlements
   * only. The session is read when there is one, because a period board is
   * drawn from the members whose prediction history the viewer may read.
   */
  @Get('leaderboard')
  async leaderboard(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ): Promise<LeaderboardResponse> {
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
    const viewer = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (parsed.query.scope === 'friends') {
      if (viewer === null) throw new UnauthorizedException(UNAUTHENTICATED);
      const among = [viewer.id, ...(await this.social.friendIds(viewer.id))];
      return this.reputation.leaderboard(parsed.query, { among, viewerId: viewer.id });
    }
    return this.reputation.leaderboard(parsed.query, { viewerId: viewer?.id ?? null });
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
    if (!parsed.ok || parsed.query.scope !== 'everyone') {
      throw new BadRequestException({
        error: 'validation',
        message: 'The request is not valid.',
        fields: parsed.ok ? { scope: 'A group board is drawn from the group.' } : parsed.fields,
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
    return this.reputation.leaderboard(parsed.query, {
      among: audience.members,
      viewerId: viewer.id,
      scope: 'group',
    });
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
