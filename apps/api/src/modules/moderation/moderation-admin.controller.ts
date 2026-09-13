import {
  BadRequestException,
  Body,
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
  AuthUser,
  DecideRequest,
  LiftSanctionRequest,
  MemberModerationHistory,
  ModerationQueueResponse,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { ModerationService } from './moderation.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_A_MODERATOR: ApiError = {
  error: 'validation',
  message: 'This needs the moderator or administrator role.',
};

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

/**
 * The moderation queue (blueprint 10.4 and 16, T-212).
 *
 * **Its own controller rather than a corner of the admin one.** The admin
 * boundary owns coverage, accounts and the audit log; moderation owns reports,
 * decisions and sanctions, and putting its SQL in `admin-store.ts` would leave
 * two modules writing the same tables. The `/admin` prefix is about who may
 * call it, not about which boundary owns it.
 *
 * **`moderator` or `admin`.** The role list has had `moderator` in it since
 * T-040 for exactly this, and blueprint 7.3 gives moderators the reports queue
 * without giving them the rest of the administration area. Every write here
 * records actor, time and reason in `audit_log`, in the same transaction as the
 * change (rule 10, D-046).
 */
@Controller('admin/moderation')
export class ModerationAdminController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly identity: IdentityService,
  ) {}

  private async moderator(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    const [isModerator, isAdmin] = await Promise.all([
      this.identity.hasRole(user.id, 'moderator'),
      this.identity.hasRole(user.id, 'admin'),
    ]);
    if (!isModerator && !isAdmin) throw new ForbiddenException(NOT_A_MODERATOR);
    return user;
  }

  @Get('queue')
  async queue(
    @Req() request: FastifyRequest,
    @Query('limit') limit?: string,
  ): Promise<ModerationQueueResponse> {
    await this.moderator(request);
    const n = Number.parseInt(limit ?? '', 10);
    const capped = Number.isInteger(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
    return this.moderation.queue(capped);
  }

  /** Everything about one member, so nobody decides blind. */
  @Get('members/:username')
  async history(
    @Param('username') username: string,
    @Req() request: FastifyRequest,
  ): Promise<MemberModerationHistory> {
    await this.moderator(request);
    const history = await this.moderation.history(username);
    if (history === null) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'No such member.',
      } satisfies ApiError);
    }
    return history;
  }

  @Post('decisions')
  async decide(
    @Body() body: DecideRequest,
    @Req() request: FastifyRequest,
  ): Promise<{ decision_id: string; answered: number }> {
    const moderator = await this.moderator(request);
    const result = await this.moderation.decide(moderator.id, body ?? ({} as DecideRequest));
    if (result.ok) return { decision_id: result.decision_id, answered: result.answered };

    if (result.reason === 'invalid') {
      throw new BadRequestException({
        error: 'validation',
        message: 'The decision is not valid.',
        fields: result.fields,
      } satisfies ApiError);
    }
    throw new NotFoundException({
      error: 'not_found',
      message: 'No such member.',
    } satisfies ApiError);
  }

  @Post('sanctions/:id/lift')
  @HttpCode(204)
  async lift(
    @Param('id') id: string,
    @Body() body: LiftSanctionRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const moderator = await this.moderator(request);
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason === '') {
      throw new BadRequestException({
        error: 'validation',
        message: 'Say why it is being lifted.',
        fields: { reason: 'Required.' },
      } satisfies ApiError);
    }

    if (!(await this.moderation.lift(moderator.id, id, reason))) {
      // Already lifted, expired, or never existed. All three mean the same
      // thing to the caller: there is nothing of that id still in force.
      throw new NotFoundException({
        error: 'not_found',
        message: 'No sanction of that id is in force.',
      } satisfies ApiError);
    }
  }
}
