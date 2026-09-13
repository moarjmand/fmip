import { Module } from '@nestjs/common';
import { ConsensusListController } from './consensus-list.controller';
import { ConsensusController } from './consensus.controller';
import { ConsensusService } from './consensus.service';

/**
 * The community consensus boundary (blueprint 6.6, T-134).
 *
 * Its own module for the same reason the founder's analysis has one: these are
 * three prediction products, and three boundaries is what makes blending them a
 * deliberate act rather than a refactor nobody noticed (rule 6). It imports
 * nothing — not the predictions module it aggregates, not the reputation module
 * whose ratings weight it — and reads what it needs from the shared schema.
 */
@Module({
  controllers: [ConsensusController, ConsensusListController],
  providers: [ConsensusService],
  exports: [ConsensusService],
})
export class ConsensusModule {}
