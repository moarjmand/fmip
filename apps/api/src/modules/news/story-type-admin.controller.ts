import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, AuthUser, StoryTypeRequest } from '@fmip/contracts';
import { ROLE_REFUSALS, STORY_TYPES, isStoryType } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PostgresStoryLabelStore } from './internal/story-label-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NO_STORY: ApiError = { error: 'not_found', message: 'No such story.' };
const MAX_TEXT = 2000;

function bad(message: string): BadRequestException {
  return new BadRequestException({ error: 'validation', message } satisfies ApiError);
}

/**
 * An editor's story type (blueprint 3.2, T-1001, D-123): `POST
 * /admin/stories/:id/type` with one of the eleven types and a reason, beside
 * the debate mark. Editors and administrators. The label supersedes the
 * current one -- the publisher's mapped category or an earlier editor's --
 * and nothing is edited; the write is an `audit_log` row with the label it
 * replaced (rule 10). An editor's label is never overwritten by a fetch
 * (T-1002).
 */
@Controller('admin')
export class StoryTypeAdminController {
  constructor(
    private readonly store: PostgresStoryLabelStore,
    private readonly identity: IdentityService,
  ) {}

  private async editor(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    const [isEditor, isAdmin] = await Promise.all([
      this.identity.hasRole(user.id, 'editor'),
      this.identity.hasRole(user.id, 'admin'),
    ]);
    if (!isEditor && !isAdmin) throw new ForbiddenException(ROLE_REFUSALS.editor);
    return user;
  }

  @Post('stories/:id/type')
  @HttpCode(204)
  async label(
    @Param('id') storyId: string,
    @Body() body: StoryTypeRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.editor(request);
    const given: unknown = body?.type;
    if (typeof given !== 'string' || !isStoryType(given)) {
      throw bad(`type must be one of ${STORY_TYPES.join(', ')}.`);
    }
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason === '') throw bad('Say why. This is recorded against the story.');
    if (!UUID.test(storyId)) throw new NotFoundException(NO_STORY);
    const outcome = await this.store.labelByEditor(
      storyId.toLowerCase(),
      user.id,
      given,
      reason.slice(0, MAX_TEXT),
    );
    if (outcome === 'no_story') throw new NotFoundException(NO_STORY);
    if (outcome === 'unchanged') {
      throw bad('An editor already gave this story that type.');
    }
  }
}
