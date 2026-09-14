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
  Patch,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiError,
  AuthUser,
  CreateGroupRequest,
  GroupInvitesResponse,
  GroupJoinRequestsResponse,
  GroupResponse,
  GroupsResponse,
  JoinGroupRequest,
  SetGroupRoleRequest,
  UpdateGroupRequest,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { type GroupOutcome, GroupsService } from './groups.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_FOUND: ApiError = { error: 'not_found', message: 'No such group.' };

function first(value: unknown): string {
  if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : '';
  return typeof value === 'string' ? value : '';
}

/**
 * Groups over HTTP (blueprint 8.2, T-241).
 *
 * **Two doors, not one endpoint that means two things.** `POST
 * /groups/:slug/members` joins a public group; `POST /groups/:slug/requests`
 * asks a discoverable one. Which one a member may use follows from the
 * visibility (D-057), the group's `standing` says which, and the database
 * refuses the other. One `POST /join` that behaved differently depending on a
 * column would have hidden that rule inside a branch.
 *
 * **An invite-only group is 404, never 403.** The same rule as a conversation
 * somebody is not in (T-221): telling a stranger it exists is already telling
 * them something about the people in it. A *discoverable* group answers 200 with
 * no membership — found, not read, which is the whole point of the middle
 * visibility.
 */
@Controller()
export class GroupsController {
  constructor(
    private readonly groups: GroupsService,
    private readonly identity: IdentityService,
  ) {}

  private async requireViewer(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return user;
  }

  // -------------------------------------------------------------------------
  // Reading
  // -------------------------------------------------------------------------

  /** The directory. Public and discoverable only; a guest may read it. */
  @Get('groups')
  async directory(@Query() query: unknown): Promise<GroupsResponse> {
    const term = first((query as Record<string, unknown> | undefined)?.q);
    return { groups: await this.groups.directory(term) };
  }

  @Get('me/groups')
  async mine(@Req() request: FastifyRequest): Promise<GroupsResponse> {
    const viewer = await this.requireViewer(request);
    return { groups: await this.groups.mine(viewer.id) };
  }

  @Get('me/group-invites')
  async invites(@Req() request: FastifyRequest): Promise<GroupInvitesResponse> {
    const viewer = await this.requireViewer(request);
    return { invites: await this.groups.invites(viewer.id) };
  }

  @Get('groups/:slug')
  async read(@Param('slug') slug: string, @Req() request: FastifyRequest): Promise<GroupResponse> {
    const viewer = await this.requireViewer(request);
    const group = await this.groups.read(viewer.id, slug);
    if (group === null) throw new NotFoundException(NOT_FOUND);
    return { group };
  }

  @Get('groups/:slug/requests')
  async requests(
    @Param('slug') slug: string,
    @Req() request: FastifyRequest,
  ): Promise<GroupJoinRequestsResponse> {
    const viewer = await this.requireViewer(request);
    return { requests: this.unwrap(await this.groups.requests(viewer.id, slug)) };
  }

  // -------------------------------------------------------------------------
  // Making and changing
  // -------------------------------------------------------------------------

  @Post('groups')
  async create(
    @Body() body: CreateGroupRequest,
    @Req() request: FastifyRequest,
  ): Promise<GroupsResponse> {
    const viewer = await this.requireViewer(request);
    return { groups: [this.unwrap(await this.groups.create(viewer.id, body ?? {}))] };
  }

  @Patch('groups/:slug')
  @HttpCode(204)
  async update(
    @Param('slug') slug: string,
    @Body() body: UpdateGroupRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.groups.update(viewer.id, slug, body ?? {}));
  }

  @Delete('groups/:slug')
  @HttpCode(204)
  async remove(@Param('slug') slug: string, @Req() request: FastifyRequest): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.groups.remove(viewer.id, slug));
  }

  // -------------------------------------------------------------------------
  // Getting in and out
  // -------------------------------------------------------------------------

  @Post('groups/:slug/members')
  @HttpCode(204)
  async join(@Param('slug') slug: string, @Req() request: FastifyRequest): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.groups.join(viewer.id, slug));
  }

  @Delete('groups/:slug/members/me')
  @HttpCode(204)
  async leave(@Param('slug') slug: string, @Req() request: FastifyRequest): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.groups.leave(viewer.id, slug));
  }

  @Put('groups/:slug/members/:username/role')
  @HttpCode(204)
  async setRole(
    @Param('slug') slug: string,
    @Param('username') username: string,
    @Body() body: SetGroupRoleRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.groups.setRole(viewer.id, slug, username, body?.role));
  }

  @Delete('groups/:slug/members/:username')
  @HttpCode(204)
  async removeMember(
    @Param('slug') slug: string,
    @Param('username') username: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.groups.removeMember(viewer.id, slug, username));
  }

  // -------------------------------------------------------------------------
  // Invitations
  // -------------------------------------------------------------------------

  @Post('groups/:slug/invites/:username')
  @HttpCode(204)
  async invite(
    @Param('slug') slug: string,
    @Param('username') username: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(
      await this.groups.invite(
        { id: viewer.id, emailVerified: viewer.email_verified },
        slug,
        username,
      ),
    );
  }

  @Delete('groups/:slug/invites/:username')
  @HttpCode(204)
  async withdrawInvite(
    @Param('slug') slug: string,
    @Param('username') username: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.groups.withdrawInvite(viewer.id, slug, username));
  }

  @Post('me/group-invites/:slug/accept')
  @HttpCode(204)
  async acceptInvite(@Param('slug') slug: string, @Req() request: FastifyRequest): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.groups.acceptInvite(viewer.id, slug));
  }

  @Delete('me/group-invites/:slug')
  @HttpCode(204)
  async declineInvite(@Param('slug') slug: string, @Req() request: FastifyRequest): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.groups.declineInvite(viewer.id, slug));
  }

  // -------------------------------------------------------------------------
  // Join requests
  // -------------------------------------------------------------------------

  @Post('groups/:slug/requests')
  @HttpCode(204)
  async askToJoin(
    @Param('slug') slug: string,
    @Body() body: JoinGroupRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.groups.askToJoin(viewer.id, slug, body?.note ?? null));
  }

  @Post('groups/:slug/requests/:username/accept')
  @HttpCode(204)
  async acceptRequest(
    @Param('slug') slug: string,
    @Param('username') username: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.groups.answerRequest(viewer.id, slug, username, true));
  }

  @Delete('groups/:slug/requests/:username')
  @HttpCode(204)
  async refuseRequest(
    @Param('slug') slug: string,
    @Param('username') username: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.groups.answerRequest(viewer.id, slug, username, false));
  }

  @Delete('me/group-requests/:slug')
  @HttpCode(204)
  async withdrawRequest(
    @Param('slug') slug: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.groups.withdrawRequest(viewer.id, slug));
  }

  /**
   * The outcome's value, or the status code its refusal deserves.
   *
   * The refusal keeps its own word in the message and takes an existing
   * `ApiError` kind on the wire. A new kind per refusal would widen a union
   * every client already switches on, for distinctions the status code and the
   * sentence already carry.
   */
  private unwrap<T>(outcome: GroupOutcome<T>): T {
    if (outcome.ok) return outcome.value;

    switch (outcome.reason) {
      case 'not_found':
        throw new NotFoundException(NOT_FOUND);
      case 'invalid':
        throw new BadRequestException({
          error: 'validation',
          message: 'The request is not valid.',
          ...(outcome.fields === undefined ? {} : { fields: outcome.fields }),
        } satisfies ApiError);
      case 'forbidden':
        throw new ForbiddenException({
          error: 'validation',
          message: 'That is for the people who run this group.',
        } satisfies ApiError);
      case 'rate_limited':
        throw new HttpException(
          {
            error: 'rate_limited',
            message: 'That is more than this hour allows.',
          } satisfies ApiError,
          429,
        );
      case 'last_owner':
        throw new ConflictException({
          error: 'conflict',
          message: 'A group needs an owner. Hand it to somebody else first.',
        } satisfies ApiError);
      case 'wrong_door':
        // The group says how it is joined, and this was not it (D-057).
        throw new ConflictException({
          error: 'conflict',
          message: 'That is not how this group is joined.',
        } satisfies ApiError);
      case 'restricted':
        throw new ConflictException({
          error: 'conflict',
          message: 'A restriction on this account stops that.',
        } satisfies ApiError);
      case 'unavailable':
        // Never "they blocked you": the same answer the social boundary gives.
        throw new ConflictException({
          error: 'conflict',
          message: 'That is not available.',
        } satisfies ApiError);
      default:
        throw new ConflictException({
          error: 'conflict',
          message: 'That has already happened.',
        } satisfies ApiError);
    }
  }
}
