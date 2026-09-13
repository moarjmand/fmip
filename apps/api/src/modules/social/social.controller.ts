import {
  BadRequestException,
  ConflictException,
  HttpException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiError,
  AuthUser,
  BlocksResponse,
  FriendRequestsResponse,
  FriendStatusResponse,
  FriendsResponse,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { type SocialOutcome, SocialService } from './social.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_FOUND: ApiError = { error: 'not_found', message: 'No such member.' };

/**
 * The social graph over HTTP (blueprint 8.1, T-201).
 *
 * Everything lives under `/me`, because every one of these answers is about the
 * signed-in member's own relationships and there is no version of them that is
 * public. A friend list is not a profile field: blueprint 7.2 puts a *count* on
 * the profile, and who those friends are is the member's to show.
 */
@Controller()
export class SocialController {
  constructor(
    private readonly social: SocialService,
    private readonly identity: IdentityService,
  ) {}

  private async requireViewer(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return user;
  }

  @Get('me/friends')
  async friends(@Req() request: FastifyRequest): Promise<FriendsResponse> {
    const viewer = await this.requireViewer(request);
    return { friends: await this.social.friends(viewer.id) };
  }

  @Delete('me/friends/:username')
  @HttpCode(204)
  async unfriend(
    @Param('username') username: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    settle(await this.social.unfriend(viewer.id, username));
  }

  @Get('me/friend-requests')
  async requests(@Req() request: FastifyRequest): Promise<FriendRequestsResponse> {
    const viewer = await this.requireViewer(request);
    return this.social.requests(viewer.id);
  }

  @Post('me/friend-requests/:username')
  @HttpCode(204)
  async send(@Param('username') username: string, @Req() request: FastifyRequest): Promise<void> {
    const viewer = await this.requireViewer(request);
    await this.settleContact(
      viewer.id,
      await this.social.request({ id: viewer.id, emailVerified: viewer.email_verified }, username),
    );
  }

  @Post('me/friend-requests/:username/accept')
  @HttpCode(204)
  async accept(@Param('username') username: string, @Req() request: FastifyRequest): Promise<void> {
    const viewer = await this.requireViewer(request);
    await this.settleContact(
      viewer.id,
      await this.social.accept({ id: viewer.id, emailVerified: viewer.email_verified }, username),
    );
  }

  /**
   * Decline a request received, or cancel one sent. One route, because the two
   * acts differ only in who started it and leave the same thing behind: no open
   * request between these two members.
   */
  @Delete('me/friend-requests/:username')
  @HttpCode(204)
  async withdraw(
    @Param('username') username: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    settle(await this.social.withdraw(viewer.id, username));
  }

  @Get('me/blocks')
  async blocks(@Req() request: FastifyRequest): Promise<BlocksResponse> {
    const viewer = await this.requireViewer(request);
    return { blocked: await this.social.blocked(viewer.id) };
  }

  @Post('me/blocks/:username')
  @HttpCode(204)
  async block(@Param('username') username: string, @Req() request: FastifyRequest): Promise<void> {
    const viewer = await this.requireViewer(request);
    settle(await this.social.block(viewer.id, username));
  }

  @Delete('me/blocks/:username')
  @HttpCode(204)
  async unblock(
    @Param('username') username: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    settle(await this.social.unblock(viewer.id, username));
  }

  /**
   * The two routes that can meet a moderation sanction (T-211).
   *
   * A restricted member is told at the moment they try to write, rather than
   * having the request quietly dropped — that is the whole point of enforcing
   * it at the write path. The message names the restriction and points at the
   * member's own standing, which carries the end date and the appeal; the API
   * does not format a date for somebody's locale.
   */
  private async settleContact(viewerId: string, outcome: SocialOutcome): Promise<void> {
    if (!outcome.ok && outcome.reason === 'restricted') {
      const sanction = await this.social.restriction(viewerId);
      throw new ForbiddenException({
        error: 'validation',
        message:
          sanction !== null && !sanction.permanent
            ? 'A moderation restriction stops you sending friend requests. Your account standing says until when, and how to appeal.'
            : 'A moderation restriction stops you sending friend requests. Your account standing says why, and how to appeal.',
      } satisfies ApiError);
    }
    settle(outcome);
  }

  /** What a profile page needs to decide which control to render. */
  @Get('me/friend-status/:username')
  async status(
    @Param('username') username: string,
    @Req() request: FastifyRequest,
  ): Promise<FriendStatusResponse> {
    const viewer = await this.requireViewer(request);
    const status = await this.social.status(viewer.id, username);
    if (status === null) throw new NotFoundException(NOT_FOUND);
    return { status };
  }
}

/**
 * Turn the service's outcome into a status code, or nothing at all.
 *
 * Every write here is idempotent, so `changed: false` is a 204 exactly like
 * `changed: true`: a member who taps block twice has blocked somebody, and
 * telling them the second tap failed would be both useless and alarming.
 */
function settle(outcome: SocialOutcome): void {
  if (outcome.ok) return;

  switch (outcome.reason) {
    case 'unknown_member':
      throw new NotFoundException(NOT_FOUND);
    case 'self':
      throw new BadRequestException({
        error: 'validation',
        message: 'That is your own account.',
      } satisfies ApiError);
    case 'email_unverified':
      throw new ForbiddenException({
        error: 'email_unverified',
        message: 'Verify your e-mail address before adding friends.',
      } satisfies ApiError);
    case 'rate_limited':
      // 429 rather than 400: the request was well formed and the answer is
      // "wait", not "fix it". A ceiling on volume is the only automation in
      // this product's moderation (D-054); nothing here reads what was written.
      throw new HttpException(
        {
          error: 'rate_limited',
          message: 'You have sent a lot of friend requests in the last hour. Try again later.',
        } satisfies ApiError,
        429,
      );
    case 'restricted':
      // Handled by `settleContact`, which can look the sanction up. Reaching
      // here would mean a route that can be sanctioned forgot to use it.
      throw new ForbiddenException({
        error: 'validation',
        message: 'A moderation restriction stops you doing that.',
      } satisfies ApiError);
    case 'unavailable':
      // Deliberately does not say that the other member has blocked the viewer.
      // See `FriendStatus` in `@fmip/contracts`: naming it would turn this
      // endpoint into a detector for a block, which is the one thing a block
      // has to stop.
      throw new ConflictException({
        error: 'conflict',
        message: 'This member is not accepting friend requests.',
      } satisfies ApiError);
  }
}
