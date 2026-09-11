import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import type { ApiError, MatchCentre } from '@fmip/contracts';
import { FixturesService } from './fixtures.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND: ApiError = { error: 'not_found', message: 'No such fixture.' };

/** `GET /fixtures/:id`: the match centre payload (T-033). Public. */
@Controller('fixtures')
export class MatchCentreController {
  constructor(private readonly fixtures: FixturesService) {}

  @Get(':fixtureId')
  async matchCentre(@Param('fixtureId') fixtureId: string): Promise<MatchCentre> {
    if (!UUID.test(fixtureId)) throw new NotFoundException(NOT_FOUND);
    const centre = await this.fixtures.matchCentre(fixtureId.toLowerCase());
    if (centre === null) throw new NotFoundException(NOT_FOUND);
    return centre;
  }
}
