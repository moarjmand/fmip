import { BadRequestException, Controller, Get, Query, Req } from '@nestjs/common';
import type { ApiError, SearchResponse } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { localeOf } from '../localised-names/localised-names.service';
import { parseSearchQuery } from './internal/search-query';
import { SearchService } from './search.service';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * `GET /search?q=&types=&limit=`. Public; a session only narrows the members
 * found, by the blocks on either side (T-642).
 */
@Controller()
export class SearchController {
  constructor(
    private readonly search: SearchService,
    private readonly identity: IdentityService,
  ) {}

  @Get('search')
  async find(@Query() query: unknown, @Req() request: FastifyRequest): Promise<SearchResponse> {
    const parsed = parseSearchQuery(isRecord(query) ? query : {});
    if (!parsed.ok) {
      const error: ApiError = {
        error: 'validation',
        message: 'The request is not valid.',
        fields: parsed.fields,
      };
      throw new BadRequestException(error);
    }
    const viewer = parsed.query.types.includes('member')
      ? await this.identity.authenticate(parseCookies(request.headers.cookie)[SESSION_COOKIE])
      : null;
    const locale = localeOf(isRecord(query) ? query.locale : undefined);
    return this.search.search(parsed.query, viewer?.id ?? null, locale);
  }
}
