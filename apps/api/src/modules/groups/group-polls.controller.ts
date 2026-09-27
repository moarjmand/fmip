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
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiError,
  AuthUser,
  CreateGroupPollRequest,
  GroupPollResponse,
  GroupPollsResponse,
  GroupPollVoteRequest,
  RemoveGroupPollRequest,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { GroupPollsService, type PollOutcome } from './group-polls.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };

/**
 * Group polls over HTTP (blueprint 8.2, T-643, D-091), under the group they
 * belong to. Every route needs a session and membership: a poll's question,
 * its answers and its counts are the group's.
 */
@Controller('groups/:slug/polls')
export class GroupPollsController {
  constructor(
    private readonly polls: GroupPollsService,
    private readonly identity: IdentityService,
  ) {}

  @Get()
  async list(
    @Param('slug') slug: string,
    @Req() request: FastifyRequest,
  ): Promise<GroupPollsResponse> {
    const viewer = await this.viewer(request);
    return { polls: this.unwrap(await this.polls.list(viewer.id, slug)) };
  }

  @Post()
  async create(
    @Param('slug') slug: string,
    @Body() body: CreateGroupPollRequest,
    @Req() request: FastifyRequest,
  ): Promise<GroupPollResponse> {
    const viewer = await this.viewer(request);
    return { poll: this.unwrap(await this.polls.create(viewer.id, slug, body ?? null)) };
  }

  @Put(':pollId/vote')
  async vote(
    @Param('slug') slug: string,
    @Param('pollId') pollId: string,
    @Body() body: GroupPollVoteRequest,
    @Req() request: FastifyRequest,
  ): Promise<GroupPollResponse> {
    const viewer = await this.viewer(request);
    return {
      poll: this.unwrap(await this.polls.vote(viewer.id, slug, pollId, body?.option_id)),
    };
  }

  @Delete(':pollId/vote')
  async withdraw(
    @Param('slug') slug: string,
    @Param('pollId') pollId: string,
    @Req() request: FastifyRequest,
  ): Promise<GroupPollResponse> {
    const viewer = await this.viewer(request);
    return { poll: this.unwrap(await this.polls.withdraw(viewer.id, slug, pollId)) };
  }

  @Post(':pollId/close')
  @HttpCode(200)
  async close(
    @Param('slug') slug: string,
    @Param('pollId') pollId: string,
    @Req() request: FastifyRequest,
  ): Promise<GroupPollResponse> {
    const viewer = await this.viewer(request);
    return { poll: this.unwrap(await this.polls.close(viewer.id, slug, pollId)) };
  }

  /** A moderation action: the owner or a moderator, with a reason, audited. */
  @Post(':pollId/removal')
  @HttpCode(204)
  async remove(
    @Param('slug') slug: string,
    @Param('pollId') pollId: string,
    @Body() body: RemoveGroupPollRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.viewer(request);
    this.unwrap(await this.polls.remove(viewer.id, slug, pollId, body?.reason));
  }

  private async viewer(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return user;
  }

  private unwrap<T>(outcome: PollOutcome<T>): T {
    if (outcome.ok) return outcome.value;
    switch (outcome.reason) {
      case 'not_found':
        throw new NotFoundException({ error: 'not_found', message: 'No such poll.' });
      case 'members_only':
        throw new ForbiddenException({
          error: 'validation',
          message: 'Polls are for the members of this group.',
        } satisfies ApiError);
      case 'forbidden':
        throw new ForbiddenException({
          error: 'validation',
          message: 'That is for whoever asked, or the people who run this group.',
        } satisfies ApiError);
      case 'invalid':
        throw new BadRequestException({
          error: 'validation',
          message: 'The request is not valid.',
          ...(outcome.fields === undefined ? {} : { fields: outcome.fields }),
        } satisfies ApiError);
      case 'poll_closed':
        throw new ConflictException({
          error: 'conflict',
          message: 'This poll is closed.',
        } satisfies ApiError);
      case 'poll_limit':
        throw new ConflictException({
          error: 'conflict',
          message: 'This group already has three open polls. Close one first.',
        } satisfies ApiError);
      case 'restricted':
        throw new ConflictException({
          error: 'conflict',
          message: 'A restriction on this account stops that.',
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
