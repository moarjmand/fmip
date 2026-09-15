import {
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiError,
  AuthUser,
  FollowStatus,
  FollowedMembersResponse,
  PanelReaction,
} from '@fmip/contracts';
import { isPanelReaction } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PanelSocialService } from './panel-social.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NO_MEMBER: ApiError = { error: 'not_found', message: 'No such member.' };
const NO_POST: ApiError = { error: 'not_found', message: 'No such post.' };

/**
 * Reacting to a panel post, and following a contributor (blueprint 10.2,
 * T-252).
 *
 * **Every write here needs a session and nothing else.** No role, no contributor
 * grant, no eligibility: reacting and following are open to members, and a gate
 * on either would be a second, quieter approval nobody decided to create. That
 * is the acceptance criterion, and the shortest place to break it is a copied
 * `approver(request)` at the top of a handler.
 *
 * **`PUT` and `DELETE` rather than `POST`.** Both are idempotent — reacting
 * twice is reacting once, and following twice is following once — so the method
 * that says so is the honest one, and a retried request after a dropped
 * connection changes nothing.
 */
@Controller()
export class PanelSocialController {
  constructor(
    private readonly social: PanelSocialService,
    private readonly identity: IdentityService,
  ) {}

  /** The viewer, or null. Some of these answer a guest. */
  private async viewer(request: FastifyRequest): Promise<AuthUser | null> {
    return this.identity.authenticate(parseCookies(request.headers.cookie)[SESSION_COOKIE]);
  }

  private async member(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.viewer(request);
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return user;
  }

  private static reaction(raw: string): PanelReaction {
    if (!isPanelReaction(raw)) {
      // A closed set, refused by name. An unknown value is a client sending
      // something this product does not have, not a member saying something new.
      throw new NotFoundException({
        error: 'not_found',
        message: 'No such reaction.',
      } satisfies ApiError);
    }
    return raw;
  }

  private static settleReaction(outcome: 'ok' | 'no_post' | 'removed'): void {
    if (outcome === 'ok') return;
    if (outcome === 'no_post') throw new NotFoundException(NO_POST);
    throw new ForbiddenException({
      error: 'validation',
      message: 'That post has been removed, so there is nothing to react to.',
    } satisfies ApiError);
  }

  @Put('panel-posts/:postId/reactions/:reaction')
  @HttpCode(204)
  async react(
    @Param('postId') postId: string,
    @Param('reaction') reaction: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.member(request);
    const kind = PanelSocialController.reaction(reaction);
    PanelSocialController.settleReaction(
      await this.social.setReaction(postId, user.id, kind, true),
    );
  }

  @Delete('panel-posts/:postId/reactions/:reaction')
  @HttpCode(204)
  async unreact(
    @Param('postId') postId: string,
    @Param('reaction') reaction: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.member(request);
    const kind = PanelSocialController.reaction(reaction);
    PanelSocialController.settleReaction(
      await this.social.setReaction(postId, user.id, kind, false),
    );
  }

  /** Whom the viewer follows. Their own list and nobody else's. */
  @Get('me/followed-members')
  async following(@Req() request: FastifyRequest): Promise<FollowedMembersResponse> {
    const user = await this.member(request);
    return this.social.following(user.id);
  }

  /**
   * One member's follower count, and the viewer's relationship to them.
   *
   * Answers a guest: the count is a public fact about a contributor, and hiding
   * it until somebody signs in would make the number appear to change when they
   * did.
   */
  @Get('members/:username/follow')
  async status(
    @Param('username') username: string,
    @Req() request: FastifyRequest,
  ): Promise<FollowStatus> {
    const viewer = await this.viewer(request);
    const status = await this.social.statusOf(username, viewer?.id ?? null);
    if (status === null) throw new NotFoundException(NO_MEMBER);
    return status;
  }

  @Put('members/:username/follow')
  @HttpCode(204)
  async follow(@Param('username') username: string, @Req() request: FastifyRequest): Promise<void> {
    const user = await this.member(request);
    PanelSocialController.settleFollow(await this.social.setFollow(username, user.id, true));
  }

  @Delete('members/:username/follow')
  @HttpCode(204)
  async unfollow(
    @Param('username') username: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.member(request);
    PanelSocialController.settleFollow(await this.social.setFollow(username, user.id, false));
  }

  private static settleFollow(outcome: 'ok' | 'no_member' | 'blocked' | 'self'): void {
    if (outcome === 'ok') return;
    if (outcome === 'no_member') throw new NotFoundException(NO_MEMBER);
    if (outcome === 'self') {
      throw new ForbiddenException({
        error: 'validation',
        message: 'That is your own account.',
      } satisfies ApiError);
    }
    // One sentence for both directions. Which of them blocked the other is not
    // something either should be able to learn here.
    throw new ForbiddenException({
      error: 'validation',
      message: 'You cannot follow that member.',
    } satisfies ApiError);
  }
}
