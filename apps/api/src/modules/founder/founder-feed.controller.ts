import { Controller, Get, Query } from '@nestjs/common';
import type { FounderAnalysesResponse } from '@fmip/contracts';
import { FounderAnalysisService } from './founder.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const DEFAULT_LIMIT = 5;
export const MAX_LIMIT = 20;

/**
 * `GET /founder-analyses` (T-132).
 *
 * The one endpoint behind three of the surfaces the blueprint names: the
 * homepage, the team page and the competition page. Public, and upcoming
 * matches only.
 *
 * A bad filter is ignored rather than rejected: this feed decorates a page that
 * has its own subject, and turning a stray query string into a 400 would take
 * down a team page over a decoration.
 */
@Controller('founder-analyses')
export class FounderFeedController {
  constructor(private readonly analyses: FounderAnalysisService) {}

  @Get()
  feed(
    @Query('limit') limit?: string,
    @Query('team') team?: string,
    @Query('competition') competition?: string,
  ): Promise<FounderAnalysesResponse> {
    const asked = Number.parseInt(limit ?? '', 10);
    return this.analyses.feed({
      limit: Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : DEFAULT_LIMIT,
      ...(team !== undefined && UUID.test(team) ? { teamId: team.toLowerCase() } : {}),
      ...(competition !== undefined && UUID.test(competition)
        ? { competitionId: competition.toLowerCase() }
        : {}),
    });
  }
}
