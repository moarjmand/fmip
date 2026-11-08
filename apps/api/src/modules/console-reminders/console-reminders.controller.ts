/**
 * `/console/calendar/push` (T-1788, D-391): a console person's browsers for the calendar's reminders, and a test message.
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, ConsoleCalendarPush, ConsoleMe } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { ConsoleCalendarService } from '../agents-console/console-calendar.service';
import { ConsoleSessions } from '../agents-console/console-sessions.service';
import { DeliveryService } from '../delivery/delivery.service';
import { ConsoleReminders } from './console-reminders.service';

const SIGNED_OUT: ApiError = { error: 'unauthenticated', message: 'Sign in to the console.' };

/** A browser's push subscription as `PushSubscription.toJSON()` gives it, checked. */
export function checkDevice(
  body: unknown,
):
  | { ok: true; endpoint: string; keys: { p256dh: string; auth: string } }
  | { ok: false; reason: string } {
  if (typeof body !== 'object' || body === null)
    return { ok: false, reason: 'A device is an object.' };
  const { endpoint, keys } = body as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  };
  if (typeof endpoint !== 'string' || !/^https:\/\/\S+$/.test(endpoint) || endpoint.length > 1000)
    return { ok: false, reason: 'endpoint is the push service https:// address.' };
  const p256dh = keys?.p256dh;
  const auth = keys?.auth;
  if (
    typeof p256dh !== 'string' ||
    typeof auth !== 'string' ||
    !/^[A-Za-z0-9_-]{20,200}={0,2}$/.test(p256dh) ||
    !/^[A-Za-z0-9_-]{8,100}={0,2}$/.test(auth)
  )
    return { ok: false, reason: 'keys are the subscription p256dh and auth.' };
  return { ok: true, endpoint, keys: { p256dh, auth } };
}

/**
 * Where the calendar's reminders reach (T-1788, D-391), under
 * `/console/calendar/push`: whether push is configured here and how many of
 * this person's browsers are on; switching a browser on or off; and a test
 * message to the person's own browsers. Uses the site's Web Push channel and
 * keys (D-074); the devices are the console's, never the members'.
 */
@Controller('console/calendar/push')
export class ConsoleRemindersController {
  constructor(
    private readonly sessions: ConsoleSessions,
    private readonly calendar: ConsoleCalendarService,
    private readonly delivery: DeliveryService,
    private readonly reminders: ConsoleReminders,
  ) {}

  @Get()
  async state(@Req() request: FastifyRequest): Promise<ConsoleCalendarPush> {
    const me = await this.person(request);
    const key = this.delivery.pushKey();
    return {
      state: key === null ? 'absent' : 'configured',
      public_key: key,
      devices: await this.calendar.deviceCount(me.id),
    };
  }

  @Post()
  @HttpCode(204)
  async add(@Body() body: unknown, @Req() request: FastifyRequest): Promise<void> {
    const me = await this.person(request);
    if (this.delivery.pushKey() === null)
      throw new ConflictException({
        error: 'conflict',
        message: 'Push is not configured on this server.',
      } satisfies ApiError);
    const checked = checkDevice(body);
    if (!checked.ok)
      throw new BadRequestException({
        error: 'validation',
        message: checked.reason,
      } satisfies ApiError);
    const agent = request.headers['user-agent'];
    await this.calendar.addDevice(
      me,
      { endpoint: checked.endpoint, keys: checked.keys },
      typeof agent === 'string' ? agent.slice(0, 300) : null,
    );
  }

  @Delete()
  @HttpCode(204)
  async remove(@Body() body: unknown, @Req() request: FastifyRequest): Promise<void> {
    const me = await this.person(request);
    const endpoint = (body as { endpoint?: unknown } | null)?.endpoint;
    const removed =
      typeof endpoint === 'string' && (await this.calendar.removeDevice(me, endpoint));
    if (!removed)
      throw new NotFoundException({
        error: 'not_found',
        message: 'No such device.',
      } satisfies ApiError);
  }

  @Post('test')
  async test(@Req() request: FastifyRequest): Promise<{ devices: number; delivered: number }> {
    const me = await this.person(request);
    return this.reminders.test(me);
  }

  private async person(request: FastifyRequest): Promise<ConsoleMe> {
    const me = await this.sessions.person(request);
    if (me === null) throw new UnauthorizedException(SIGNED_OUT);
    return me;
  }
}
