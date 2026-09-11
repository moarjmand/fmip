import {
  BadRequestException,
  Controller,
  Get,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, ScoresResponse } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { FixturesService, parseScoresQuery } from './fixtures.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `GET /scores?from=&to=&tz=&live=&favourites=&country=&competition=&stage=&gender=&age=`.
 * Public; a session adds pinning and enables `favourites`.
 */
@Controller()
export class ScoresController {
  constructor(
    private readonly fixtures: FixturesService,
    private readonly identity: IdentityService,
  ) {}

  @Get('scores')
  async scores(@Query() query: unknown, @Req() request: FastifyRequest): Promise<ScoresResponse> {
    const parsed = parseScoresQuery(isRecord(query) ? query : {});
    if (!parsed.ok) {
      const error: ApiError = {
        error: 'validation',
        message: 'The request is not valid.',
        fields: parsed.fields,
      };
      throw new BadRequestException(error);
    }

    const viewer = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    const outcome = await this.fixtures.scores(parsed.filters, viewer?.id ?? null);
    if (outcome.kind === 'needs_session') {
      const error: ApiError = {
        error: 'unauthenticated',
        message: 'Sign in to filter by your favourites.',
      };
      throw new UnauthorizedException(error);
    }
    return outcome.response;
  }
}
