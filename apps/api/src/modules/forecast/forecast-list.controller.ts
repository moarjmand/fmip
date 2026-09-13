import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { type ApiError, type ForecastListResponse, MAX_FORECAST_FIXTURES } from '@fmip/contracts';
import { ForecastService } from './forecast.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `GET /forecasts?fixtures=<id>,<id>` (T-136).
 *
 * The model's latest forecast for several fixtures at once, so a page showing a
 * day's matches asks once instead of once per match.
 *
 * **Its own endpoint, not a combined one.** The consensus has a route of the
 * same shape on its own module. A single "predictions overview" returning both
 * would be shorter and is what rule 6 exists to prevent: one payload holding
 * two products is one refactor away from one payload with a `source` field, and
 * a reader who can no longer tell which of the three they are looking at.
 */
@Controller('forecasts')
export class ForecastListController {
  constructor(private readonly forecasts: ForecastService) {}

  @Get()
  async list(@Query('fixtures') fixtures?: string): Promise<ForecastListResponse> {
    return { fixtures: await this.forecasts.latestFor(parseFixtures(fixtures)) };
  }
}

/**
 * The `fixtures` parameter, or a 400 naming what was wrong.
 *
 * A malformed id is rejected rather than skipped: silently dropping it would
 * give a caller with one typo a shorter list and no way to tell which match is
 * missing from it.
 */
export function parseFixtures(raw: string | undefined): string[] {
  const ids = (raw ?? '')
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part !== '');

  if (ids.length > MAX_FORECAST_FIXTURES) {
    const error: ApiError = {
      error: 'validation',
      message: `Ask about at most ${MAX_FORECAST_FIXTURES} fixtures at a time.`,
    };
    throw new BadRequestException(error);
  }
  const bad = ids.find((id) => !UUID.test(id));
  if (bad !== undefined) {
    const error: ApiError = { error: 'validation', message: `"${bad}" is not a fixture id.` };
    throw new BadRequestException(error);
  }
  return [...new Set(ids.map((id) => id.toLowerCase()))];
}
