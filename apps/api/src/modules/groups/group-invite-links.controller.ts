import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  AcceptGroupRulesRequest,
  ApiError,
  AuthUser,
  CreateGroupInviteLinkRequest,
  FollowInviteLinkResponse,
  GroupInviteLinkResponse,
  GroupInviteLinksResponse,
  InviteLinkPreviewResponse,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { GroupInviteLinksService, type LinkOutcome } from './group-invite-links.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };

/**
 * Invite links over HTTP (blueprint 8.2, T-1021, D-132).
 *
 * Managing them is under the group (`/groups/:slug/invite-links`); following
 * one is under the token (`/group-invite-links/:token`), because whoever holds
 * a link may not yet know the group's handle -- or be allowed to.
 */
@Controller()
export class GroupInviteLinksController {
  constructor(
    private readonly links: GroupInviteLinksService,
    private readonly identity: IdentityService,
  ) {}

  @Post('groups/:slug/invite-links')
  async create(
    @Param('slug') slug: string,
    @Body() body: CreateGroupInviteLinkRequest,
    @Req() request: FastifyRequest,
  ): Promise<GroupInviteLinkResponse> {
    const viewer = await this.viewer(request);
    return {
      link: this.unwrap(
        await this.links.create(
          { id: viewer.id, emailVerified: viewer.email_verified },
          slug,
          body,
        ),
      ),
    };
  }

  @Get('groups/:slug/invite-links')
  async list(
    @Param('slug') slug: string,
    @Req() request: FastifyRequest,
  ): Promise<GroupInviteLinksResponse> {
    const viewer = await this.viewer(request);
    return { links: this.unwrap(await this.links.list(viewer.id, slug)) };
  }

  @Delete('groups/:slug/invite-links/:id')
  @HttpCode(204)
  async revoke(
    @Param('slug') slug: string,
    @Param('id') id: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.viewer(request);
    this.unwrap(await this.links.revoke(viewer.id, slug, id));
  }

  @Get('group-invite-links/:token')
  async preview(
    @Param('token') token: string,
    @Req() request: FastifyRequest,
  ): Promise<InviteLinkPreviewResponse> {
    const viewer = await this.viewer(request);
    return { preview: this.unwrap(await this.links.preview(viewer.id, token)) };
  }

  @Post('group-invite-links/:token')
  async follow(
    @Param('token') token: string,
    @Body() body: AcceptGroupRulesRequest,
    @Req() request: FastifyRequest,
  ): Promise<FollowInviteLinkResponse> {
    const viewer = await this.viewer(request);
    return this.unwrap(await this.links.follow(viewer.id, token, body?.rules_version));
  }

  private async viewer(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return user;
  }

  private unwrap<T>(outcome: LinkOutcome<T>): T {
    if (outcome.ok) return outcome.value;
    switch (outcome.reason) {
      case 'not_found':
        throw new NotFoundException({
          error: 'not_found',
          message: 'No such invite link.',
        } satisfies ApiError);
      case 'invalid':
        throw new BadRequestException({
          error: 'validation',
          message: 'The request is not valid.',
          ...(outcome.fields === undefined ? {} : { fields: outcome.fields }),
        } satisfies ApiError);
      case 'forbidden':
        throw new ForbiddenException({
          error: 'forbidden',
          message: 'That is for the people in this group who may invite.',
        } satisfies ApiError);
      case 'policy':
        throw new ForbiddenException({
          error: 'forbidden',
          message: outcome.message ?? 'This group does not let you invite.',
        } satisfies ApiError);
      case 'gone':
        // A dead link says which kind of dead (T-1021).
        throw new HttpException(
          {
            error: 'conflict',
            message: outcome.message ?? 'This invite link no longer works.',
          } satisfies ApiError,
          410,
        );
      case 'already_member':
        throw new ConflictException({
          error: 'conflict',
          message: 'You are already in this group.',
        } satisfies ApiError);
      case 'restricted':
        throw new ConflictException({
          error: 'conflict',
          message: 'A restriction on this account stops that.',
        } satisfies ApiError);
      case 'unavailable':
        throw new ConflictException({
          error: 'conflict',
          message: 'That is not available.',
        } satisfies ApiError);
      case 'closed':
        throw new ConflictException({
          error: 'conflict',
          message: 'This group is closed. Nobody new can join it.',
        } satisfies ApiError);
      case 'rules':
        throw new ConflictException({
          error: 'conflict',
          message: outcome.message ?? "Accept this group's rules to join.",
        } satisfies ApiError);
      case 'rate_limited':
        throw new HttpException(
          {
            error: 'rate_limited',
            message: 'That is more than this hour allows.',
          } satisfies ApiError,
          429,
        );
    }
  }
}
