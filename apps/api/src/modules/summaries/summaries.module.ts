import { Module } from '@nestjs/common';
import { ConsensusModule } from '../consensus/consensus.module';
import { FixturesModule } from '../fixtures/fixtures.module';
import { ForecastModule } from '../forecast/forecast.module';
import { IdentityModule } from '../identity/identity.module';
import { IntelligenceModule } from '../intelligence/intelligence.module';
import { PostgresMatchSummaryStore } from './internal/match-summary-store';
import { SummariesController } from './summaries.controller';
import { SummariesService } from './summaries.service';

/**
 * Match summaries (E41, Phase 5): the record read through the public
 * services of fixtures, forecast and consensus -- never their internals --
 * assembled into facts, handed to the language model behind the
 * intelligence port, checked, and stored as versions. Off the critical path:
 * nothing imports this module, and the match page reads a stored row.
 */
@Module({
  imports: [FixturesModule, ForecastModule, ConsensusModule, IntelligenceModule, IdentityModule],
  controllers: [SummariesController],
  providers: [PostgresMatchSummaryStore, SummariesService],
  exports: [SummariesService],
})
export class SummariesModule {}
