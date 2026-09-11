import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import type { ApiError, SearchResponse } from '@fmip/contracts';
import { parseSearchQuery } from './internal/search-query';
import { SearchService } from './search.service';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** `GET /search?q=&types=&limit=`. Public. */
@Controller()
export class SearchController {
  constructor(private readonly search: SearchService) {}

  @Get('search')
  async find(@Query() query: unknown): Promise<SearchResponse> {
    const parsed = parseSearchQuery(isRecord(query) ? query : {});
    if (!parsed.ok) {
      const error: ApiError = {
        error: 'validation',
        message: 'The request is not valid.',
        fields: parsed.fields,
      };
      throw new BadRequestException(error);
    }
    return this.search.search(parsed.query);
  }
}
