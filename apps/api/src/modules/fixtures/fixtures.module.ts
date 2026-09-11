import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ProfileModule } from '../profile/profile.module';
import { FixturesService } from './fixtures.service';
import { PostgresScoresStore } from './internal/scores-store';
import { ScoresController } from './scores.controller';

/**
 * The fixtures boundary (02-architecture.md): matches, incidents, lineups,
 * statistics and coverage. Today its read side: the scores list (T-030).
 */
@Module({
  imports: [IdentityModule, ProfileModule],
  controllers: [ScoresController],
  providers: [FixturesService, PostgresScoresStore],
  exports: [FixturesService],
})
export class FixturesModule {}
