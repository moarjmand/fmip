import { BadRequestException, Controller, Get, Query, Req } from '@nestjs/common';
import type { ApiError, MomentsResponse } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { localeOf } from '../localised-names/localised-names.service';
import { MomentsService, parseMomentsQuery } from './moments.service';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * `GET /moments?timezone=&locale=&big_one=` (T-1641, D-299; T-1644, D-302): today's moments that
 * matter, for the site's top bar. Public. A session, as on `GET /scores`,
 * only marks the viewer's followed matches; without one the answer depends on
 * the zone, the language and the time alone, so the web keeps a guest's
 * answer and shares it the way it shares the scores rail's (T-1381).
 */
@Controller()
export class MomentsController {
  constructor(
    private readonly moments: MomentsService,
    private readonly identity: IdentityService,
  ) {}

  @Get('moments')
  async list(@Query() query: unknown, @Req() request: FastifyRequest): Promise<MomentsResponse> {
    const raw = isRecord(query) ? query : {};
    const parsed = parseMomentsQuery(raw);
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
    return this.moments.today(
      parsed.timeZone,
      localeOf(raw.locale),
      viewer?.id ?? null,
      parsed.bigOneLive,
    );
  }
}
