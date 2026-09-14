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
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiError,
  AuthUser,
  ConversationPage,
  ConversationSearchResponse,
  ConversationsResponse,
  SendMessageRequest,
  SendMessageResponse,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { type ConversationOutcome, ConversationsService } from './conversations.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_FOUND: ApiError = { error: 'not_found', message: 'No such conversation.' };

/**
 * Conversations over HTTP (blueprint 8.3, T-221).
 *
 * Everything is under `/me`, because a conversation is only ever answered *to a
 * participant*: there is no public reading of one, and a route shaped like
 * `/conversations/:id` would invite one.
 *
 * **Correct before it is fast.** Nothing here needs a socket. Opening,
 * sending, paging back, read state, mute and leave all work over ordinary
 * requests, which is what T-224 builds a page on — and it is why the transport
 * of T-230 can be added to something already right rather than becoming the
 * source of truth by accident.
 */
@Controller('me/conversations')
export class ConversationsController {
  constructor(
    private readonly conversations: ConversationsService,
    private readonly identity: IdentityService,
  ) {}

  private async requireViewer(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return user;
  }

  @Get()
  async list(@Req() request: FastifyRequest): Promise<ConversationsResponse> {
    const viewer = await this.requireViewer(request);
    return { conversations: await this.conversations.list(viewer.id) };
  }

  @Post('direct/:username')
  async open(
    @Param('username') username: string,
    @Req() request: FastifyRequest,
  ): Promise<{ id: string }> {
    const viewer = await this.requireViewer(request);
    const outcome = await this.conversations.openDirect(
      { id: viewer.id, emailVerified: viewer.email_verified },
      username,
    );
    return { id: this.unwrap(outcome) };
  }

  @Get(':id')
  async read(
    @Param('id') id: string,
    @Req() request: FastifyRequest,
    @Query('before') before?: string,
  ): Promise<ConversationPage> {
    const viewer = await this.requireViewer(request);
    const parsed = Number.parseInt(before ?? '', 10);
    const page = await this.conversations.page(
      viewer.id,
      id,
      Number.isInteger(parsed) && parsed > 0 ? parsed : null,
    );
    // A conversation the viewer is not in is "not found" rather than
    // "forbidden": a 403 would confirm that this id names a real conversation.
    if (page === null) throw new NotFoundException(NOT_FOUND);
    return page;
  }

  @Get(':id/search')
  async search(
    @Param('id') id: string,
    @Req() request: FastifyRequest,
    @Query('q') q?: string,
  ): Promise<ConversationSearchResponse> {
    const viewer = await this.requireViewer(request);
    const found = await this.conversations.search(viewer.id, id, q ?? '');
    if (found === null) throw new NotFoundException(NOT_FOUND);
    return found;
  }

  @Post(':id/messages')
  async send(
    @Param('id') id: string,
    @Body() body: SendMessageRequest,
    @Req() request: FastifyRequest,
  ): Promise<SendMessageResponse> {
    const viewer = await this.requireViewer(request);
    const outcome = await this.conversations.send(
      viewer.id,
      id,
      body ?? ({} as SendMessageRequest),
    );
    return { message: this.unwrap(outcome) };
  }

  @Delete(':id/messages/:messageId')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.conversations.removeOwn(viewer.id, id, messageId));
  }

  @Put(':id/messages/:messageId/reactions/:reaction')
  @HttpCode(204)
  async react(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Param('reaction') reaction: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.conversations.react(viewer.id, id, messageId, reaction));
  }

  @Delete(':id/messages/:messageId/reactions/:reaction')
  @HttpCode(204)
  async unreact(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Param('reaction') reaction: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.conversations.unreact(viewer.id, id, messageId, reaction));
  }

  @Post(':id/messages/:messageId/pin')
  @HttpCode(204)
  async pin(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.conversations.setPinned(viewer.id, id, messageId, true));
  }

  @Delete(':id/messages/:messageId/pin')
  @HttpCode(204)
  async unpin(
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    this.unwrap(await this.conversations.setPinned(viewer.id, id, messageId, false));
  }

  @Post(':id/read')
  @HttpCode(204)
  async markRead(
    @Param('id') id: string,
    @Body() body: { seq?: number },
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    const seq = typeof body?.seq === 'number' && Number.isInteger(body.seq) ? body.seq : null;
    if (seq === null || seq < 0) {
      throw new BadRequestException({
        error: 'validation',
        message: 'Say which sequence has been read.',
        fields: { seq: 'A whole number.' },
      } satisfies ApiError);
    }
    if (!(await this.conversations.markRead(viewer.id, id, seq))) {
      throw new NotFoundException(NOT_FOUND);
    }
  }

  @Post(':id/mute')
  @HttpCode(204)
  async mute(@Param('id') id: string, @Req() request: FastifyRequest): Promise<void> {
    const viewer = await this.requireViewer(request);
    if (!(await this.conversations.setMuted(viewer.id, id, true))) {
      throw new NotFoundException(NOT_FOUND);
    }
  }

  @Delete(':id/mute')
  @HttpCode(204)
  async unmute(@Param('id') id: string, @Req() request: FastifyRequest): Promise<void> {
    const viewer = await this.requireViewer(request);
    if (!(await this.conversations.setMuted(viewer.id, id, false))) {
      throw new NotFoundException(NOT_FOUND);
    }
  }

  /** Leaving is never gated: it is the exit. */
  @Post(':id/leave')
  @HttpCode(204)
  async leave(@Param('id') id: string, @Req() request: FastifyRequest): Promise<void> {
    const viewer = await this.requireViewer(request);
    if (!(await this.conversations.leave(viewer.id, id))) throw new NotFoundException(NOT_FOUND);
  }

  /** The outcome's value, or the status code its refusal deserves. */
  private unwrap<T>(outcome: ConversationOutcome<T>): T {
    if (outcome.ok) return outcome.value;

    switch (outcome.reason) {
      case 'invalid':
        throw new BadRequestException({
          error: 'validation',
          message: 'The message is not valid.',
          fields: outcome.fields,
        } satisfies ApiError);
      case 'self':
        throw new BadRequestException({
          error: 'validation',
          message: 'That is your own account.',
        } satisfies ApiError);
      case 'unknown_member':
      case 'not_found':
        throw new NotFoundException(NOT_FOUND);
      case 'email_unverified':
        throw new ForbiddenException({
          error: 'email_unverified',
          message: 'Verify your e-mail address before messaging.',
        } satisfies ApiError);
      case 'not_friends':
        // Blueprint 8.1 gives "start a direct conversation" to friends, and
        // taking that literally is what removes the direct-message spam surface
        // entirely: nobody can put words in front of somebody who has not
        // agreed to hear from them.
        throw new ConflictException({
          error: 'conflict',
          message: 'You can message members you are friends with.',
        } satisfies ApiError);
      case 'unavailable':
        throw new ConflictException({
          error: 'conflict',
          message: 'This conversation is not available.',
        } satisfies ApiError);
      case 'left':
        throw new ConflictException({
          error: 'conflict',
          message: 'You have left this conversation.',
        } satisfies ApiError);
      case 'removed':
        throw new ConflictException({
          error: 'conflict',
          message: 'That message has been removed.',
        } satisfies ApiError);
      case 'restricted':
        throw new ForbiddenException({
          error: 'validation',
          message:
            'A moderation restriction stops you sending messages. Your account standing says why, and how to appeal.',
        } satisfies ApiError);
      case 'rate_limited':
        throw new HttpException(
          {
            error: 'rate_limited',
            message: 'You have sent a lot of messages in the last hour. Try again later.',
          } satisfies ApiError,
          429,
        );
    }
  }
}
