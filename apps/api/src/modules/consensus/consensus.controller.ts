import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import type { ApiError, CommunityConsensusResponse } from '@fmip/contracts';
import { ConsensusService } from './consensus.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND: ApiError = { error: 'not_found', message: 'No such fixture.' };

/**
 * `GET /fixtures/:id/consensus` (T-134, blueprint 6.6).
 *
 * Public, like the other two prediction products: what a crowd thinks is one of
 * the things a reader comes for, and it says nothing about any individual.
 *
 * Its own controller rather than another route on the predictions one, because
 * the predictions boundary is about a member's own submission — it answers 401
 * to a guest and 403 to an unverified account — and this answers everybody.
 */
@Controller('fixtures/:fixtureId/consensus')
export class ConsensusController {
  constructor(private readonly consensus: ConsensusService) {}

  @Get()
  async get(@Param('fixtureId') fixtureId: string): Promise<CommunityConsensusResponse> {
    if (!UUID.test(fixtureId)) throw new NotFoundException(NOT_FOUND);

    const payload = await this.consensus.forFixture(fixtureId);
    if (payload === null) throw new NotFoundException(NOT_FOUND);
    return payload;
  }
}
