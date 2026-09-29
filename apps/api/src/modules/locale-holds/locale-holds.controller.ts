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
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  type ApiError,
  HOLDABLE_LOCALES,
  type HeldLocalesResponse,
  type LocaleHoldListResponse,
  type LocaleHoldRequest,
  ROLE_REFUSALS,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PostgresLocaleHoldStore } from './internal/locale-hold-store';

const REASON_MAX = 500;
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };

function validation(message: string): BadRequestException {
  return new BadRequestException({ error: 'validation', message } satisfies ApiError);
}

/**
 * Holding back a language that is ready (T-1163, D-155).
 *
 * `GET /locale-holds` is public: the locales held now, which the web takes
 * out of what it offers -- the picker, the first run -- for everybody. The
 * console side is administrators': `POST /admin/locales/:locale/hold` and
 * `.../release`, each with a reason and an `audit_log` row with what was
 * there before (rule 10), and `GET /admin/locale-holds` for the history.
 * Whether a locale's catalogue is ready is the web's to know (`isShippable`);
 * a hold may be placed on any real language but English, and only ever takes
 * a language away.
 */
@Controller()
export class LocaleHoldsController {
  constructor(
    private readonly store: PostgresLocaleHoldStore,
    private readonly identity: IdentityService,
  ) {}

  @Get('locale-holds')
  async held(): Promise<HeldLocalesResponse> {
    const rows = await this.store.held();
    return {
      generated_at: new Date().toISOString(),
      held: rows.map((row) => ({ locale: row.locale, held_at: row.held_at.toISOString() })),
    };
  }

  @Get('admin/locale-holds')
  async list(@Req() request: FastifyRequest): Promise<LocaleHoldListResponse> {
    await this.administrator(request);
    return { holds: await this.store.list() };
  }

  @Post('admin/locales/:locale/hold')
  @HttpCode(204)
  async hold(
    @Param('locale') locale: string,
    @Body() body: LocaleHoldRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const actor = await this.administrator(request);
    const reason = LocaleHoldsController.reason(body);
    const target = LocaleHoldsController.locale(locale);
    if ((await this.store.hold(target, actor.id, reason)) === 'already') {
      throw validation('This language is already held back. Release it first.');
    }
  }

  @Post('admin/locales/:locale/release')
  @HttpCode(204)
  async release(
    @Param('locale') locale: string,
    @Body() body: LocaleHoldRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const actor = await this.administrator(request);
    const reason = LocaleHoldsController.reason(body);
    const target = LocaleHoldsController.locale(locale);
    if (!(await this.store.release(target, actor.id, reason))) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'This language is not held back.',
      } satisfies ApiError);
    }
  }

  private static reason(body: unknown): string {
    const raw = typeof body === 'object' && body !== null ? (body as { reason?: unknown }) : {};
    const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
    if (reason === '') throw validation('Say why. This is recorded against the language.');
    if (reason.length > REASON_MAX) throw validation(`At most ${REASON_MAX} characters.`);
    return reason;
  }

  private static locale(given: string): string {
    const locale = given.toLowerCase();
    if (!(HOLDABLE_LOCALES as readonly string[]).includes(locale)) {
      throw new NotFoundException({
        error: 'not_found',
        message: `No such language to hold back; one of ${HOLDABLE_LOCALES.join(', ')}. English is never held.`,
      } satisfies ApiError);
    }
    return locale;
  }

  private async administrator(request: FastifyRequest) {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin')))
      throw new ForbiddenException(ROLE_REFUSALS.administrator);
    return user;
  }
}
