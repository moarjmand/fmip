import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiError,
  ConsoleCanvas,
  ConsoleCanvasCard,
  ConsoleCanvasKey,
  ConsoleMe,
} from '@fmip/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { refuseOverRate } from '../rate-limits/rate-limits.service';
import { ConsoleSessions } from './console-sessions.service';
import {
  CANVAS_ID,
  checkCanvasKey,
  checkCardPatch,
  checkMove,
  checkNewCard,
} from './internal/canvas-rules';
import { type CanvasOutcome, PostgresCanvasStore } from './internal/canvas-store';

const SIGNED_OUT: ApiError = { error: 'unauthenticated', message: 'Sign in to the console.' };
const NO_CARD: ApiError = { error: 'not_found', message: 'No such canvas card.' };
const LIMIT = 'That is the most canvas changes an hour allows.';

/**
 * The console's business model canvas (T-1856, D-441), under
 * `/console/canvas`: the nine blocks' cards, the bin and the history. Two
 * canvases (T-1872, D-448): every route takes `?canvas=claude|teammate`, and
 * without it is Claude's, as every route was before; a card route answers
 * 404 for a card of the other canvas, so a page open on one tab never
 * changes the other. Every
 * route needs a console session (no guest, no member); every change is
 * written by the store with its event row(s) and its `console_audit` row
 * carrying the whole card before and after, and held to the
 * `console_canvas` ceiling. Nothing deletes a row: removal goes to the bin,
 * which restores. CSRF is the console's posture: the cookie is `SameSite`,
 * nothing changes on `GET`, and a form-encoded body is refused before any
 * handler (`console-security.http.spec.ts`).
 */
@Controller('console/canvas')
export class ConsoleCanvasController {
  constructor(
    private readonly sessions: ConsoleSessions,
    private readonly store: PostgresCanvasStore,
  ) {}

  @Get()
  async canvas(
    @Query('canvas') key: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ConsoleCanvas> {
    await this.person(request);
    return this.store.canvas(canvasOf(key));
  }

  @Post('cards')
  async create(
    @Query('canvas') key: unknown,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleCanvasCard> {
    const actor = await this.person(request);
    const canvas = canvasOf(key);
    const checked = checkNewCard(body);
    if (!checked.ok) throw invalid(checked.reason);
    return answer(await this.store.createCard(canvas, checked.value, actor), reply);
  }

  @Patch('cards/:id')
  async change(
    @Query('canvas') key: unknown,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleCanvasCard> {
    const actor = await this.person(request);
    const canvas = canvasOf(key);
    if (!CANVAS_ID.test(id)) throw new NotFoundException(NO_CARD);
    const checked = checkCardPatch(body);
    if (!checked.ok) throw invalid(checked.reason);
    return answer(await this.store.patchCard(canvas, id, checked.value, actor), reply);
  }

  @Post('cards/:id/move')
  @HttpCode(200)
  async move(
    @Query('canvas') key: unknown,
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleCanvasCard> {
    const actor = await this.person(request);
    const canvas = canvasOf(key);
    if (!CANVAS_ID.test(id)) throw new NotFoundException(NO_CARD);
    const checked = checkMove(body);
    if (!checked.ok) throw invalid(checked.reason);
    return answer(await this.store.moveCard(canvas, id, checked.value, actor), reply);
  }

  /** Into the bin: the row, its place and its history stay. */
  @Post('cards/:id/remove')
  @HttpCode(200)
  async remove(
    @Query('canvas') key: unknown,
    @Param('id') id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleCanvasCard> {
    const actor = await this.person(request);
    const canvas = canvasOf(key);
    if (!CANVAS_ID.test(id)) throw new NotFoundException(NO_CARD);
    return answer(await this.store.removeCard(canvas, id, actor), reply);
  }

  /** Out of the bin, back to its place in its block. */
  @Post('cards/:id/restore')
  @HttpCode(200)
  async restore(
    @Query('canvas') key: unknown,
    @Param('id') id: string,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleCanvasCard> {
    const actor = await this.person(request);
    const canvas = canvasOf(key);
    if (!CANVAS_ID.test(id)) throw new NotFoundException(NO_CARD);
    return answer(await this.store.restoreCard(canvas, id, actor), reply);
  }

  private async person(request: FastifyRequest): Promise<ConsoleMe> {
    const me = await this.sessions.person(request);
    if (me === null) throw new UnauthorizedException(SIGNED_OUT);
    return me;
  }
}

/** The route's canvas from `?canvas=`; none is Claude's (T-1872). */
function canvasOf(key: unknown): ConsoleCanvasKey {
  const checked = checkCanvasKey(key);
  if (!checked.ok) throw invalid(checked.reason);
  return checked.value;
}

function invalid(message: string): BadRequestException {
  return new BadRequestException({ error: 'validation', message } satisfies ApiError);
}

function answer(outcome: CanvasOutcome, reply: FastifyReply): ConsoleCanvasCard {
  switch (outcome.kind) {
    case 'ok':
      return outcome.card;
    case 'limited':
      return refuseOverRate(
        reply,
        { ok: false, retryAfterSeconds: outcome.retryAfterSeconds },
        LIMIT,
      );
    case 'missing':
      throw new NotFoundException(NO_CARD);
    case 'invalid':
      throw invalid(outcome.reason);
    case 'refused':
      throw new ConflictException({
        error: 'conflict',
        message: outcome.reason,
      } satisfies ApiError);
  }
}
