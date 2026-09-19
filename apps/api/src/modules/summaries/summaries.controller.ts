import {
  BadRequestException,
  Body,
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
  MatchSummaryOutcome,
  MatchSummaryRequest,
  MatchSummaryResponse,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { SummariesService } from './summaries.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_FIXTURE: ApiError = { error: 'not_found', message: 'No such fixture.' };
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_AN_EDITOR: ApiError = {
  error: 'validation',
  message: 'This needs the editor or administrator role.',
};
const MAX_TEXT = 2000;

/**
 * Match summaries (E41): `GET /fixtures/:id/summary` for anyone -- the
 * published version or the reason there is none -- and `POST
 * /admin/fixtures/:id/summary` for an editor to ask for a new version, with
 * the reason the audit log keeps (rule 10). The answer to the editor is the
 * outcome, including a rejection with its reason, so they know what
 * happened without reading a log.
 */
@Controller()
export class SummariesController {
  constructor(
    private readonly summaries: SummariesService,
    private readonly identity: IdentityService,
  ) {}

  @Get('fixtures/:id/summary')
  async current(@Param('id') id: string): Promise<MatchSummaryResponse> {
    if (!UUID.test(id)) throw new NotFoundException(NO_FIXTURE);
    const response = await this.summaries.current(id.toLowerCase());
    if (response === null) throw new NotFoundException(NO_FIXTURE);
    return response;
  }

  @Post('admin/fixtures/:id/summary')
  async generate(
    @Param('id') id: string,
    @Body() body: MatchSummaryRequest,
    @Req() request: FastifyRequest,
  ): Promise<MatchSummaryOutcome> {
    const user = await this.editor(request);
    const reason = typeof body?.reason === 'string' ? body.reason.trim().slice(0, MAX_TEXT) : '';
    if (reason === '') {
      throw new BadRequestException({
        error: 'validation',
        message: 'Say why a new version is wanted. This is recorded against the match.',
      } satisfies ApiError);
    }
    if (!UUID.test(id)) throw new NotFoundException(NO_FIXTURE);
    const outcome = await this.summaries.generate(id.toLowerCase(), user.id, reason);
    if (outcome === 'no_fixture') throw new NotFoundException(NO_FIXTURE);
    return outcome;
  }

  private async editor(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    const [isEditor, isAdmin] = await Promise.all([
      this.identity.hasRole(user.id, 'editor'),
      this.identity.hasRole(user.id, 'admin'),
    ]);
    if (!isEditor && !isAdmin) throw new ForbiddenException(NOT_AN_EDITOR);
    return user;
  }
}
