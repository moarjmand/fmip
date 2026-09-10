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
import type {
  ApiError,
  ForecastKind,
  ForecastVersion,
  ForecastVersionsResponse,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { ForecastService } from './forecast.service';

const KINDS: readonly ForecastKind[] = [
  'early',
  'lineups_predicted',
  'lineups_confirmed',
  'manual',
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND: ApiError = { error: 'not_found', message: 'No such fixture.' };
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `/fixtures/:id/forecasts`. Reading is public: the forecast is a product
 * surface. Computing a version is an operator action (the ingestion jobs will
 * call the service directly, T-026); over HTTP it needs an admin session.
 */
@Controller('fixtures/:fixtureId/forecasts')
export class ForecastController {
  constructor(
    private readonly forecasts: ForecastService,
    private readonly identity: IdentityService,
  ) {}

  @Get()
  async list(@Param('fixtureId') fixtureId: string): Promise<ForecastVersionsResponse> {
    if (!UUID.test(fixtureId)) throw new NotFoundException(NOT_FOUND);
    const response = await this.forecasts.versions(fixtureId.toLowerCase());
    if (response === null) throw new NotFoundException(NOT_FOUND);
    return response;
  }

  @Post()
  @HttpCode(201)
  async compute(
    @Param('fixtureId') fixtureId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<ForecastVersion> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin'))) {
      const error: ApiError = {
        error: 'unauthenticated',
        message: 'Computing a forecast needs the admin role.',
      };
      throw new ForbiddenException(error);
    }

    if (!UUID.test(fixtureId)) throw new NotFoundException(NOT_FOUND);
    const kind = isRecord(body) ? body.kind : undefined;
    if (typeof kind !== 'string' || !(KINDS as readonly string[]).includes(kind)) {
      const error: ApiError = {
        error: 'validation',
        message: 'The request is not valid.',
        fields: { kind: `must be one of ${KINDS.join(', ')}` },
      };
      throw new BadRequestException(error);
    }

    const outcome = await this.forecasts.compute(fixtureId.toLowerCase(), kind as ForecastKind);
    if (outcome.kind === 'unknown_fixture') throw new NotFoundException(NOT_FOUND);
    return outcome.version;
  }
}
