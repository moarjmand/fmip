import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import type { ApiError, KeyPlayers, MatchCentre } from '@fmip/contracts';
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

  /**
   * `GET /fixtures/:id/key-players` (T-841): each side's most-used players
   * this season, by the stated rule. Public. Its own request rather than a
   * module of the match centre, so the live stream does not recount a
   * season on every goal.
   */
  @Get(':fixtureId/key-players')
  async keyPlayers(@Param('fixtureId') fixtureId: string): Promise<KeyPlayers> {
    if (!UUID.test(fixtureId)) throw new NotFoundException(NOT_FOUND);
    const players = await this.fixtures.keyPlayers(fixtureId.toLowerCase());
    if (players === null) throw new NotFoundException(NOT_FOUND);
    return players;
  }
}
