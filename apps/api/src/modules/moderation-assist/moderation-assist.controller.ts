import {
  Controller,
  ForbiddenException,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, AuthUser, SuggestionOutcome } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { ModerationAssistService } from './moderation-assist.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_A_MODERATOR: ApiError = {
  error: 'validation',
  message: 'This needs the moderator or administrator role.',
};
const NO_REPORT: ApiError = { error: 'not_found', message: 'No such report.' };

/**
 * `POST /admin/moderation/reports/:id/suggest` (T-441): a moderator asks the
 * assistant about one report -- a new suggestion version, or the reason
 * there is none. It changes nothing about the report; the queue shows the
 * result beside it.
 */
@Controller('admin/moderation')
export class ModerationAssistController {
  constructor(
    private readonly assist: ModerationAssistService,
    private readonly identity: IdentityService,
  ) {}

  @Post('reports/:id/suggest')
  async suggest(
    @Param('id') id: string,
    @Req() request: FastifyRequest,
  ): Promise<SuggestionOutcome> {
    await this.moderator(request);
    if (!UUID.test(id)) throw new NotFoundException(NO_REPORT);
    const outcome = await this.assist.suggest(id.toLowerCase());
    if (outcome === 'no_report') throw new NotFoundException(NO_REPORT);
    return outcome;
  }

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
}
