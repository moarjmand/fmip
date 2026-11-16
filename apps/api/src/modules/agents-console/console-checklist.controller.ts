import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Patch,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, ConsoleChecklist, ConsoleChecklistItem, ConsoleMe } from '@fmip/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { refuseOverRate } from '../rate-limits/rate-limits.service';
import { ConsoleSessions } from './console-sessions.service';
import {
  CHECKLIST_ID,
  checkItemPatch,
  checkMove,
  checkNewItem,
  checkNote,
  checkRemoval,
} from './internal/checklist-rules';
import { type ChecklistOutcome, PostgresChecklistStore } from './internal/checklist-store';

const SIGNED_OUT: ApiError = { error: 'unauthenticated', message: 'Sign in to the console.' };
const NO_ITEM: ApiError = { error: 'not_found', message: 'No such checklist item.' };
const NO_SECTION: ApiError = { error: 'not_found', message: 'No such checklist section.' };
const LIMIT = 'That is the most checklist changes an hour allows.';

/**
 * The console's pre-launch checklist (T-1840, D-428), under
 * `/console/checklist`: the two lists, each item's status, assignee, notes
 * and history. Every route needs a console session (no guest, no member);
 * every change is written by the store with its history row and its
 * `console_audit` row and previous value, and held to the
 * `console_checklist` ceiling. CSRF is the console's posture: the cookie is
 * `SameSite`, nothing changes on `GET`, and a form-encoded body is refused
 * before any handler (`console-security.http.spec.ts`).
 */
@Controller('console/checklist')
export class ConsoleChecklistController {
  constructor(
    private readonly sessions: ConsoleSessions,
    private readonly store: PostgresChecklistStore,
  ) {}

  @Get()
  async checklist(@Req() request: FastifyRequest): Promise<ConsoleChecklist> {
    await this.person(request);
    return this.store.checklist();
  }

  @Post('items')
  async create(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleChecklistItem> {
    const actor = await this.person(request);
    const checked = checkNewItem(body);
    if (!checked.ok) throw invalid(checked.reason);
    const outcome = await this.store.createItem(checked.value, actor);
    if (outcome.kind === 'missing') throw new NotFoundException(NO_SECTION);
    return answer(outcome, reply);
  }

  @Patch('items/:id')
  async change(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleChecklistItem> {
    const actor = await this.person(request);
    if (!CHECKLIST_ID.test(id)) throw new NotFoundException(NO_ITEM);
    const checked = checkItemPatch(body);
    if (!checked.ok) throw invalid(checked.reason);
    return answer(await this.store.patchItem(id, checked.value, actor), reply);
  }

  @Post('items/:id/move')
  async move(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleChecklistItem> {
    const actor = await this.person(request);
    if (!CHECKLIST_ID.test(id)) throw new NotFoundException(NO_ITEM);
    const checked = checkMove(body);
    if (!checked.ok) throw invalid(checked.reason);
    return answer(await this.store.moveItem(id, checked.value, actor), reply);
  }

  @Post('items/:id/notes')
  async note(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<ConsoleChecklistItem> {
    const actor = await this.person(request);
    if (!CHECKLIST_ID.test(id)) throw new NotFoundException(NO_ITEM);
    const checked = checkNote(body);
    if (!checked.ok) throw invalid(checked.reason);
    return answer(await this.store.addNote(id, checked.value, actor), reply);
  }

  /** A removal says why; the item, its notes and history stay in the database. */
  @Delete('items/:id')
  @HttpCode(204)
  async remove(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<void> {
    const actor = await this.person(request);
    if (!CHECKLIST_ID.test(id)) throw new NotFoundException(NO_ITEM);
    const checked = checkRemoval(body);
    if (!checked.ok) throw invalid(checked.reason);
    const outcome = await this.store.removeItem(id, checked.value, actor);
    if (outcome.kind === 'ok') return;
    answer(outcome, reply);
  }

  private async person(request: FastifyRequest): Promise<ConsoleMe> {
    const me = await this.sessions.person(request);
    if (me === null) throw new UnauthorizedException(SIGNED_OUT);
    return me;
  }
}

function invalid(message: string): BadRequestException {
  return new BadRequestException({ error: 'validation', message } satisfies ApiError);
}

function answer(outcome: ChecklistOutcome, reply: FastifyReply): ConsoleChecklistItem {
  switch (outcome.kind) {
    case 'ok':
      return outcome.item;
    case 'limited':
      return refuseOverRate(
        reply,
        { ok: false, retryAfterSeconds: outcome.retryAfterSeconds },
        LIMIT,
      );
    case 'missing':
      throw new NotFoundException(NO_ITEM);
    case 'refused':
      throw new ConflictException({
        error: 'conflict',
        message: outcome.reason,
      } satisfies ApiError);
  }
}
