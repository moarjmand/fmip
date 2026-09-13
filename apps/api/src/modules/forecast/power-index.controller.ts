import {
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
import type { ApiError, PowerIndexResponse } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PowerIndexService } from './power-index.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND: ApiError = { error: 'not_found', message: 'No such fixture.' };
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };

const NONE_YET = 'no Power Index has been computed for this match yet';

/**
 * `/fixtures/:id/power-index` (T-114, blueprint 6.1).
 *
 * Reading is public, because the index is a product surface; computing is an
 * operator action, the same split the forecast uses (T-065). A `GET` never
 * computes: an index is a statement about a moment, and one created as a side
 * effect of somebody loading a page would be a statement about when they
 * happened to look.
 */
@Controller('fixtures/:fixtureId/power-index')
export class PowerIndexController {
  constructor(
    private readonly indexes: PowerIndexService,
    private readonly identity: IdentityService,
  ) {}

  @Get()
  async latest(@Param('fixtureId') fixtureId: string): Promise<PowerIndexResponse> {
    if (!UUID.test(fixtureId)) throw new NotFoundException(NOT_FOUND);
    const index = await this.indexes.latest(fixtureId.toLowerCase());
    return index === null
      ? { index: null, unavailable_reason: NONE_YET }
      : { index, unavailable_reason: null };
  }

  @Post()
  @HttpCode(201)
  async compute(
    @Param('fixtureId') fixtureId: string,
    @Req() request: FastifyRequest,
  ): Promise<PowerIndexResponse> {
    await this.requireAdmin(request);
    if (!UUID.test(fixtureId)) throw new NotFoundException(NOT_FOUND);

    const outcome = await this.indexes.compute(fixtureId.toLowerCase());
    if (outcome.kind === 'unknown_fixture') throw new NotFoundException(NOT_FOUND);
    // A refusal is a 201 with the reason, not an error: "this match cannot be
    // measured, and here is why" is the answer, and the caller asked correctly.
    return outcome.kind === 'computed'
      ? { index: outcome.pair, unavailable_reason: null }
      : { index: null, unavailable_reason: outcome.reason };
  }

  /** The same gate the forecast's compute uses (T-065). */
  private async requireAdmin(request: FastifyRequest): Promise<void> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin'))) {
      const error: ApiError = {
        error: 'unauthenticated',
        message: 'Computing a Power Index needs the admin role.',
      };
      throw new ForbiddenException(error);
    }
  }
}
