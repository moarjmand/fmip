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
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, ConsoleCalendar, ConsoleCalendarEvent, ConsoleMe } from '@fmip/contracts';
import { CONSOLE_CALENDAR_TIME_ZONE, wallClock } from '@fmip/contracts/console';
import type { FastifyRequest } from 'fastify';
import { ConsoleSessions } from './console-sessions.service';
import { EVENT_ID, checkEvent } from './internal/calendar-rules';
import { type EventOutcome, PostgresCalendarStore } from './internal/calendar-store';

const SIGNED_OUT: ApiError = { error: 'unauthenticated', message: 'Sign in to the console.' };
const NO_EVENT: ApiError = { error: 'not_found', message: 'No such event.' };

/**
 * The console's calendar and reminders (T-1788, D-391), under
 * `/console/calendar`: the shared notes and reminders, and the subscriptions
 * list they remind of. Every route needs a console session; every change is
 * audited by the store. The push side (devices, the reminder run) is the
 * `console-reminders` module, which needs the delivery channel this module
 * must not import (its command-line tool runs without one).
 */
@Controller('console/calendar')
export class ConsoleCalendarController {
  constructor(
    private readonly sessions: ConsoleSessions,
    private readonly store: PostgresCalendarStore,
  ) {}

  @Get()
  async calendar(@Req() request: FastifyRequest): Promise<ConsoleCalendar> {
    await this.person(request);
    const [events, subscriptions, recent] = await Promise.all([
      this.store.events(),
      this.store.subscriptions(),
      this.store.recentReminders(),
    ]);
    return {
      events,
      subscriptions,
      recent_reminders: recent,
      today: wallClock(new Date()).date,
      time_zone: CONSOLE_CALENDAR_TIME_ZONE,
    };
  }

  @Post('events')
  async create(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ConsoleCalendarEvent> {
    const actor = await this.person(request);
    const checked = checkEvent(body);
    if (!checked.ok) throw invalid(checked.reason);
    return answer(await this.store.createEvent(checked.value, actor));
  }

  @Patch('events/:id')
  async change(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ConsoleCalendarEvent> {
    const actor = await this.person(request);
    if (!EVENT_ID.test(id)) throw new NotFoundException(NO_EVENT);
    const checked = checkEvent(body);
    if (!checked.ok) throw invalid(checked.reason);
    return answer(await this.store.updateEvent(id, checked.value, actor));
  }

  @Delete('events/:id')
  @HttpCode(204)
  async remove(@Param('id') id: string, @Req() request: FastifyRequest): Promise<void> {
    const actor = await this.person(request);
    const removed = EVENT_ID.test(id) && (await this.store.deleteEvent(id, actor));
    if (!removed) throw new NotFoundException(NO_EVENT);
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

function answer(outcome: EventOutcome): ConsoleCalendarEvent {
  switch (outcome.kind) {
    case 'ok':
      return outcome.event;
    case 'missing':
      throw new NotFoundException(NO_EVENT);
    case 'refused':
      throw new ConflictException({
        error: 'conflict',
        message: outcome.reason,
      } satisfies ApiError);
  }
}
