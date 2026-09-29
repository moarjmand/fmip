import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiError,
  AuthUser,
  GroupAppealRequest,
  GroupAppealResponse,
  GroupDecisionRequest,
  GroupDecisionResponse,
  GroupModerationView,
  RemoveGroupContentRequest,
} from '@fmip/contracts';
import { ROLE_REFUSALS } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import {
  type GroupAppealResult,
  type GroupDecisionResult,
  GroupModerationService,
} from './group-moderation.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NO_GROUP: ApiError = { error: 'not_found', message: 'No such group.' };

async function viewer(identity: IdentityService, request: FastifyRequest): Promise<AuthUser> {
  const user = await identity.authenticate(parseCookies(request.headers.cookie)[SESSION_COOKIE]);
  if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
  return user;
}

/**
 * Administrators and groups (blueprint 10.4, T-1025, D-135): `moderator` or
 * `admin`, the same gate as the rest of the moderation queue. Every write is
 * a decision with a reason, and its audit row, in one transaction.
 */
@Controller('admin/moderation/groups/:slug')
export class GroupModerationAdminController {
  constructor(
    private readonly groups: GroupModerationService,
    private readonly identity: IdentityService,
  ) {}

  private async moderator(request: FastifyRequest): Promise<AuthUser> {
    const user = await viewer(this.identity, request);
    const [isModerator, isAdmin] = await Promise.all([
      this.identity.hasRole(user.id, 'moderator'),
      this.identity.hasRole(user.id, 'admin'),
    ]);
    if (!isModerator && !isAdmin) throw new ForbiddenException(ROLE_REFUSALS.moderator);
    return user;
  }

  @Get()
  async view(
    @Param('slug') slug: string,
    @Req() request: FastifyRequest,
  ): Promise<GroupModerationView> {
    await this.moderator(request);
    const found = await this.groups.view(slug);
    if (found === null) throw new NotFoundException(NO_GROUP);
    return found;
  }

  @Post('close')
  async close(
    @Param('slug') slug: string,
    @Body() body: GroupDecisionRequest,
    @Req() request: FastifyRequest,
  ): Promise<GroupDecisionResponse> {
    const moderator = await this.moderator(request);
    return this.unwrap(await this.groups.close(moderator.id, slug, body));
  }

  @Post('reopen')
  async reopen(
    @Param('slug') slug: string,
    @Body() body: GroupDecisionRequest,
    @Req() request: FastifyRequest,
  ): Promise<GroupDecisionResponse> {
    const moderator = await this.moderator(request);
    return this.unwrap(await this.groups.reopen(moderator.id, slug, body));
  }

  @Post('removal')
  async removal(
    @Param('slug') slug: string,
    @Body() body: RemoveGroupContentRequest,
    @Req() request: FastifyRequest,
  ): Promise<GroupDecisionResponse> {
    const moderator = await this.moderator(request);
    return this.unwrap(await this.groups.removeContent(moderator.id, slug, body));
  }

  @Post('dismissal')
  async dismissal(
    @Param('slug') slug: string,
    @Body() body: GroupDecisionRequest,
    @Req() request: FastifyRequest,
  ): Promise<GroupDecisionResponse> {
    const moderator = await this.moderator(request);
    return this.unwrap(await this.groups.dismiss(moderator.id, slug, body));
  }

  private unwrap(result: GroupDecisionResult): GroupDecisionResponse {
    if (result.ok) return result.value;
    switch (result.reason) {
      case 'invalid':
        throw new BadRequestException({
          error: 'validation',
          message: 'The decision is not valid.',
          ...(result.fields === undefined ? {} : { fields: result.fields }),
        } satisfies ApiError);
      case 'not_found':
        throw new NotFoundException(NO_GROUP);
      case 'nothing':
        throw new ConflictException({
          error: 'conflict',
          message: 'Nothing named is still standing in this group.',
        } satisfies ApiError);
      case 'conflict':
        throw new ConflictException({
          error: 'conflict',
          message:
            'The group is not in the state that needs: it is already closed, or already open.',
        } satisfies ApiError);
    }
  }
}

/**
 * The owner's appeal of a closure (T-1025, T-211's notes). Only the owner:
 * the appeal is about their group, and a member who wants out can leave.
 */
@Controller('groups/:slug/closure/appeal')
export class GroupClosureAppealController {
  constructor(
    private readonly groups: GroupModerationService,
    private readonly identity: IdentityService,
  ) {}

  @Get()
  async read(
    @Param('slug') slug: string,
    @Req() request: FastifyRequest,
  ): Promise<GroupAppealResponse> {
    const user = await viewer(this.identity, request);
    return this.unwrap(await this.groups.appealView(user.id, slug));
  }

  @Post()
  async appeal(
    @Param('slug') slug: string,
    @Body() body: GroupAppealRequest,
    @Req() request: FastifyRequest,
  ): Promise<GroupAppealResponse> {
    const user = await viewer(this.identity, request);
    return this.unwrap(await this.groups.appeal(user.id, slug, body));
  }

  private unwrap(result: GroupAppealResult): GroupAppealResponse {
    if (result.ok) return result.value;
    switch (result.reason) {
      case 'invalid':
        throw new BadRequestException({
          error: 'validation',
          message: 'The appeal is not valid.',
          ...(result.fields === undefined ? {} : { fields: result.fields }),
        } satisfies ApiError);
      case 'not_owner':
        throw new ForbiddenException({
          error: 'forbidden',
          message: "Appealing a group's closure is for its owner.",
        } satisfies ApiError);
      case 'not_closed':
        throw new ConflictException({
          error: 'conflict',
          message: 'This group is not closed.',
        } satisfies ApiError);
      case 'not_found':
        throw new NotFoundException(NO_GROUP);
    }
  }
}
