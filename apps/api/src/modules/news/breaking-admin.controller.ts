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
  BreakingClearRequest,
  BreakingListResponse,
  BreakingMarkRequest,
  BreakingRecord,
} from '@fmip/contracts';
import { ROLE_REFUSALS } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PostgresBreakingAdminStore } from './internal/breaking-admin-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NO_STORY: ApiError = { error: 'not_found', message: 'No such story.' };
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_TEXT = 500;

/**
 * The editor's breaking mark (blueprint 2.3, T-1004, D-125): `POST
 * /admin/stories/:id/breaking` with the note readers see on the homepage
 * strip, for `BREAKING_WINDOW_HOURS`; `POST .../breaking/clear` with a reason
 * to end it early; `GET /admin/breaking` to list marks. Editors and
 * administrators. Every mark and clear is an `audit_log` row (rule 10).
 */
@Controller('admin')
export class BreakingAdminController {
  constructor(
    private readonly store: PostgresBreakingAdminStore,
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

  private static text(given: unknown, message: string): string {
    const text = typeof given === 'string' ? given.trim() : '';
    if (text === '') {
      throw new BadRequestException({ error: 'validation', message } satisfies ApiError);
    }
    return text.slice(0, MAX_TEXT);
  }

  @Get('breaking')
  async list(
    @Req() request: FastifyRequest,
    @Query('state') state?: string,
    @Query('limit') limit?: string,
  ): Promise<BreakingListResponse> {
    await this.editor(request);
    const n = Number.parseInt(limit ?? '', 10);
    const capped = Number.isInteger(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
    const rows = await this.store.list(state === 'live' ? 'live' : 'all', capped);
    return {
      generated_at: new Date().toISOString(),
      marks: rows.map((row): BreakingRecord => ({
        story_id: row.story_id,
        headline: row.headline,
        marked_by: row.marked_by,
        note: row.note,
        marked_at: row.marked_at.toISOString(),
        ends_at: row.ends_at.toISOString(),
        cleared_by: row.cleared_by,
        cleared_reason: row.cleared_reason,
        cleared_at: row.cleared_at?.toISOString() ?? null,
        state: row.cleared_at !== null ? 'cleared' : row.live ? 'live' : 'expired',
      })),
    };
  }

  @Post('stories/:id/breaking')
  @HttpCode(204)
  async mark(
    @Param('id') storyId: string,
    @Body() body: BreakingMarkRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.editor(request);
    const note = BreakingAdminController.text(
      body?.note,
      'Say why this is breaking. Readers see it on the homepage.',
    );
    if (!UUID.test(storyId)) throw new NotFoundException(NO_STORY);
    const outcome = await this.store.mark(storyId.toLowerCase(), user.id, note);
    if (outcome.kind === 'no_story') throw new NotFoundException(NO_STORY);
    if (outcome.kind === 'already') {
      throw new BadRequestException({
        error: 'validation',
        message: 'This story is already marked breaking. Clear it first to change the note.',
      } satisfies ApiError);
    }
  }

  @Post('stories/:id/breaking/clear')
  @HttpCode(204)
  async clear(
    @Param('id') storyId: string,
    @Body() body: BreakingClearRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.editor(request);
    const reason = BreakingAdminController.text(
      body?.reason,
      'Say why. This is recorded against the story.',
    );
    if (!UUID.test(storyId) || !(await this.store.clear(storyId.toLowerCase(), user.id, reason))) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'This story is not marked breaking now.',
      } satisfies ApiError);
    }
  }
}
