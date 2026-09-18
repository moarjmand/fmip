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
  DebateClearRequest,
  DebateListResponse,
  DebateRecord,
  DebateSelectionRequest,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PostgresDebateAdminStore, type DebateFilter } from './internal/debate-admin-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_AN_EDITOR: ApiError = {
  error: 'validation',
  message: 'This needs the editor or administrator role.',
};
const NO_STORY: ApiError = { error: 'not_found', message: 'No such story.' };
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_TEXT = 2000;

/**
 * The editor's half of the debate section (blueprint 3.1, T-143): `GET
 * /admin/debates`, `POST /admin/stories/:id/debate` to select a story with the
 * note readers see, and `POST .../debate/clear` with a reason. Editors and
 * administrators; the note and the reason are required and land in the audit
 * log (rule 10). Not a `DELETE`: a cleared selection stays as the record of
 * what was on the page and who took it off.
 */
@Controller('admin')
export class DebateAdminController {
  constructor(
    private readonly store: PostgresDebateAdminStore,
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
    if (!isEditor && !isAdmin) throw new ForbiddenException(NOT_AN_EDITOR);
    return user;
  }

  private static text(given: unknown, message: string): string {
    const text = typeof given === 'string' ? given.trim() : '';
    if (text === '') {
      throw new BadRequestException({ error: 'validation', message } satisfies ApiError);
    }
    return text.slice(0, MAX_TEXT);
  }

  @Get('debates')
  async list(
    @Req() request: FastifyRequest,
    @Query('state') state?: string,
    @Query('limit') limit?: string,
  ): Promise<DebateListResponse> {
    await this.editor(request);
    const filter: DebateFilter = state === 'open' || state === 'cleared' ? state : 'all';
    const n = Number.parseInt(limit ?? '', 10);
    const capped = Number.isInteger(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
    const rows = await this.store.list(filter, capped);
    return {
      generated_at: new Date().toISOString(),
      selections: rows.map((row): DebateRecord => ({
        story_id: row.story_id,
        headline: row.headline,
        selected_by: row.selected_by,
        note: row.note,
        selected_at: row.selected_at.toISOString(),
        cleared_by: row.cleared_by,
        cleared_reason: row.cleared_reason,
        cleared_at: row.cleared_at?.toISOString() ?? null,
      })),
    };
  }

  @Post('stories/:id/debate')
  @HttpCode(204)
  async select(
    @Param('id') storyId: string,
    @Body() body: DebateSelectionRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.editor(request);
    const note = DebateAdminController.text(
      body?.note,
      'Say why this is a debate. Readers see it beside the story.',
    );
    if (!UUID.test(storyId) || !(await this.store.storyExists(storyId))) {
      throw new NotFoundException(NO_STORY);
    }
    if ((await this.store.select(storyId, user.id, note)) === 'already') {
      throw new BadRequestException({
        error: 'validation',
        message: 'This story is already on the debate page. Clear it first to change the note.',
      } satisfies ApiError);
    }
  }

  @Post('stories/:id/debate/clear')
  @HttpCode(204)
  async clear(
    @Param('id') storyId: string,
    @Body() body: DebateClearRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.editor(request);
    const reason = DebateAdminController.text(
      body?.reason,
      'Say why. This is recorded against the story.',
    );
    if (!UUID.test(storyId) || !(await this.store.clear(storyId, user.id, reason))) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'This story is not on the debate page.',
      } satisfies ApiError);
    }
  }
}
