import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ProfileModule } from '../profile/profile.module';
import { FixturesService } from './fixtures.service';
import { PostgresMatchCentreStore } from './internal/match-centre-store';
import { PostgresScoresStore } from './internal/scores-store';
import { MatchCentreController } from './match-centre.controller';
import { ScoresController } from './scores.controller';

/**
 * The fixtures boundary (02-architecture.md): matches, incidents, lineups,
 * statistics and coverage. Its read side: the scores list (T-030) and the
 * match centre (T-033).
 */
@Module({
  imports: [IdentityModule, ProfileModule],
  controllers: [ScoresController, MatchCentreController],
  providers: [FixturesService, PostgresScoresStore, PostgresMatchCentreStore],
  exports: [FixturesService],
})
export class FixturesModule {}
