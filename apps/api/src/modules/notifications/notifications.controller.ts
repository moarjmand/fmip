import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import type {
  ApiError,
  AuthUser,
  Notification,
  NotificationKind,
  NotificationSettings,
  NotificationSubject,
  NotificationsResponse,
  SetNotificationPreferenceRequest,
  SetQuietHoursRequest,
} from '@fmip/contracts';
import {
  MUTE_SCOPES,
  NOTIFICATION_DEFAULTS,
  NOTIFICATION_KINDS,
  type MuteScope,
  isNotificationKind,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { DeliveryService } from '../delivery/delivery.service';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { NotificationsService } from './notifications.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/** `HH:MM`, and nothing else. A time this cannot parse is not a time. */
const CLOCK = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * The inbox, and what a member may change about it (blueprint 12.2, T-272).
 *
 * **Everything here is `/me`.** A notification is addressed to one person and
 * there is no reading of anybody else's — not for an administrator either. An
 * inbox is the closest thing this product has to somebody's private
 * correspondence with it.
 *
 * **The deep link is a pair, not a URL.** The API sends `subject_type` and
 * `subject_id`; the client turns them into a route. A URL built here would put
 * the web app's routing table in the API, and the second client Phase 4 plans
 * (E32) would have to either accept the web's routes or ignore the field.
 */
@Controller()
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly identity: IdentityService,
    private readonly delivery: DeliveryService,
  ) {}

  private async viewer(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return user;
  }

  private static kind(raw: string): NotificationKind {
    if (!isNotificationKind(raw)) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'No such notification kind.',
      } satisfies ApiError);
    }
    return raw;
  }

  @Get('me/notifications')
  async inbox(
    @Req() request: FastifyRequest,
    @Query('limit') limit?: string,
  ): Promise<NotificationsResponse> {
    const user = await this.viewer(request);
    const n = Number.parseInt(limit ?? '', 10);
    const capped = Number.isInteger(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;

    const [rows, unread] = await Promise.all([
      this.notifications.inbox(user.id, capped),
      this.notifications.unread(user.id),
    ]);
    return {
      notifications: rows.map((row): Notification => ({
        id: row.id,
        kind: row.kind as NotificationKind,
        subject_type: row.subject_type as NotificationSubject,
        subject_id: row.subject_id,
        subject_label: row.subject_label,
        source: row.source,
        created_at: row.created_at.toISOString(),
        read_at: row.read_at?.toISOString() ?? null,
        held_reason: row.held_reason,
      })),
      // Said on every page of the inbox (T-330): with no provider, this is
      // the only place a notification exists.
      delivery: this.delivery.describe(),
      // Across the whole inbox, not this page: a badge counting only what was
      // fetched would go down when somebody scrolled.
      unread,
      generated_at: new Date().toISOString(),
    };
  }

  @Post('me/notifications/read')
  @HttpCode(200)
  async readAll(@Req() request: FastifyRequest): Promise<{ read: number }> {
    const user = await this.viewer(request);
    return { read: await this.notifications.readAll(user.id) };
  }

  @Post('me/notifications/:id/read')
  @HttpCode(204)
  async read(@Param('id') id: string, @Req() request: FastifyRequest): Promise<void> {
    const user = await this.viewer(request);
    // Somebody else's, already read, or never there: all 404. Telling a caller
    // "that exists but is not yours" answers "does this id exist" for anybody
    // who guesses one.
    if (!(await this.notifications.read(id, user.id))) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'No unread notification of yours with that id.',
      } satisfies ApiError);
    }
  }

  /**
   * Every kind, with the value in force and whether it is theirs.
   *
   * All of them, not only the departures: a client that received only what the
   * member had changed would need the defaults too, which is how a second copy
   * of them gets written (T-270).
   */
  @Get('me/notification-settings')
  async settings(@Req() request: FastifyRequest): Promise<NotificationSettings> {
    const user = await this.viewer(request);
    const [muted, chosen, quiet, mutes] = await Promise.all([
      this.notifications.mutedKinds(user.id),
      this.notifications.chosenKinds(user.id),
      this.notifications.quietHours(user.id),
      this.notifications.mutes(user.id),
    ]);
    return {
      preferences: NOTIFICATION_KINDS.map((kind) => ({
        kind,
        in_product: chosen.has(kind) ? !muted.has(kind) : NOTIFICATION_DEFAULTS[kind],
        chosen: chosen.has(kind),
      })),
      quiet_hours: quiet,
      // The timezone the window is read in. Shown because a member who moved
      // and never updated their account would otherwise see a quiet window that
      // behaves inexplicably (T-040).
      timezone: user.timezone,
      mutes: mutes.map((m) => ({
        scope: m.scope,
        target: m.target,
        label: m.label,
        created_at: m.created_at.toISOString(),
      })),
    };
  }

  // --- mutes (T-331, blueprint 12.2) ------------------------------------

  private static scope(raw: string): MuteScope {
    if (!(MUTE_SCOPES as readonly string[]).includes(raw)) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'No such mute scope.',
      } satisfies ApiError);
    }
    return raw as MuteScope;
  }

  /** Silence a team, a competition or a category. Idempotent. */
  @Put('me/notification-mutes/:scope/:target')
  @HttpCode(204)
  async mute(
    @Param('scope') scope: string,
    @Param('target') target: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.viewer(request);
    const wanted = NotificationsController.scope(scope);
    const outcome = await this.notifications.mute(user.id, wanted, target.trim().toLowerCase());
    if (outcome === 'unknown') {
      throw new BadRequestException({
        error: 'validation',
        message:
          wanted === 'category'
            ? 'No such category.'
            : `No such ${wanted}; a mute names one by its id.`,
      } satisfies ApiError);
    }
  }

  @Delete('me/notification-mutes/:scope/:target')
  @HttpCode(204)
  async unmute(
    @Param('scope') scope: string,
    @Param('target') target: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.viewer(request);
    const wanted = NotificationsController.scope(scope);
    if (!(await this.notifications.unmute(user.id, wanted, target.trim().toLowerCase()))) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'Nothing was silenced under that name.',
      } satisfies ApiError);
    }
  }

  @Put('me/notification-settings/:kind')
  @HttpCode(204)
  async setPreference(
    @Param('kind') kind: string,
    @Body() body: SetNotificationPreferenceRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.viewer(request);
    await this.notifications.setPreference(
      user.id,
      NotificationsController.kind(kind),
      body?.in_product === true,
    );
  }

  @Put('me/quiet-hours')
  @HttpCode(204)
  async setQuietHours(
    @Body() body: SetQuietHoursRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.viewer(request);
    const starts = String(body?.starts_at ?? '');
    const ends = String(body?.ends_at ?? '');
    if (!CLOCK.test(starts) || !CLOCK.test(ends)) {
      throw new BadRequestException({
        error: 'validation',
        message: 'Times are HH:MM on a 24-hour clock.',
      } satisfies ApiError);
    }
    if (starts === ends) {
      // Equal ends are a whole day and no day at once, and nothing can tell
      // them apart. The database refuses it too; this says it in words.
      throw new BadRequestException({
        error: 'validation',
        message: 'A window that starts and ends at the same time means nothing. Pick two times.',
      } satisfies ApiError);
    }
    await this.notifications.setQuietHours(user.id, starts, ends);
  }

  @Delete('me/quiet-hours')
  @HttpCode(204)
  async clearQuietHours(@Req() request: FastifyRequest): Promise<void> {
    const user = await this.viewer(request);
    // Silent when there were none: the end state is what was asked for.
    await this.notifications.clearQuietHours(user.id);
  }
}
