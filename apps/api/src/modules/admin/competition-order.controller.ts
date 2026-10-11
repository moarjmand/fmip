import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  type AdminCompetitionsResponse,
  type ApiError,
  COMPETITION_ORDER_MAX,
  ROLE_REFUSALS,
  type SetCompetitionOrderResponse,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PostgresCompetitionOrderStore } from './internal/competition-order-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REASON_MAX = 500;
/** A language subtag whose own order is meant (T-1391, D-207): `en`, never `en-GB`. */
const LANGUAGE = /^[a-z]{2,3}$/;
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NO_COMPETITION: ApiError = { error: 'not_found', message: 'No such competition.' };

/**
 * The competitions' order in the console (T-1162, D-154), administrators
 * only, as `catalog.mjs --set-order` is the operator's: `GET
 * /admin/competitions` lists every competition in the order readers meet
 * them, `PUT /admin/competitions/:id/order` states a place (1 first) or clears
 * it (`null`) with a reason. The scores page and the homepage read the order
 * at render, so the next one shows it. `?locale=en` lists and sets that
 * language's own order instead of the default one (T-1391, D-207).
 */
@Controller('admin/competitions')
export class CompetitionOrderController {
  constructor(
    private readonly store: PostgresCompetitionOrderStore,
    private readonly identity: IdentityService,
  ) {}

  @Get()
  async list(
    @Query('locale') rawLocale: unknown,
    @Req() request: FastifyRequest,
  ): Promise<AdminCompetitionsResponse> {
    await this.administrator(request);
    const locale = this.language(rawLocale);
    return { competitions: await this.store.competitions(locale), locale };
  }

  @Put(':id/order')
  async setOrder(
    @Param('id') id: string,
    @Body() body: unknown,
    @Query('locale') rawLocale: unknown,
    @Req() request: FastifyRequest,
  ): Promise<SetCompetitionOrderResponse> {
    const actor = await this.administrator(request);
    const locale = this.language(rawLocale);
    const raw = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
    const fields: Record<string, string> = {};
    const order = raw.order;
    if (
      order !== null &&
      (typeof order !== 'number' ||
        !Number.isInteger(order) ||
        order < 1 ||
        order > COMPETITION_ORDER_MAX)
    ) {
      fields.order = `A whole number from 1 (first) to ${COMPETITION_ORDER_MAX}, or null to clear the place.`;
    }
    const reason = typeof raw.reason === 'string' ? raw.reason.trim() : '';
    if (reason === '') fields.reason = 'Say why. Every administrative change records its reason.';
    else if (reason.length > REASON_MAX) fields.reason = `At most ${REASON_MAX} characters.`;
    if (Object.keys(fields).length > 0) {
      throw new BadRequestException({
        error: 'validation',
        message: 'The request is not valid.',
        fields,
      } satisfies ApiError);
    }
    if (!UUID.test(id)) throw new NotFoundException(NO_COMPETITION);
    const next = order as number | null;
    const outcome = await this.store.setOrder(actor.id, id.toLowerCase(), next, reason, locale);
    if (outcome === null) throw new NotFoundException(NO_COMPETITION);
    return { previous: outcome.previous, next, audit_id: outcome.auditId };
  }

  /** `?locale=`: a language subtag, else 400; absent, the default order. */
  private language(raw: unknown): string | null {
    if (raw === undefined || raw === '') return null;
    if (typeof raw === 'string' && LANGUAGE.test(raw)) return raw;
    throw new BadRequestException({
      error: 'validation',
      message: 'The request is not valid.',
      fields: { locale: 'A language subtag in lower case, e.g. en.' },
    } satisfies ApiError);
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
