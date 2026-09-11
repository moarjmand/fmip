import {
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
import type { ApiError, RatingResponse } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { ReputationService } from './reputation.service';

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
