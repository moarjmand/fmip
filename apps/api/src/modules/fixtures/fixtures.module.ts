import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ProfileModule } from '../profile/profile.module';
import { FixturesService } from './fixtures.service';
import { FixtureChangeFeed } from './internal/change-feed';
import { PostgresMatchCentreStore } from './internal/match-centre-store';
import { PostgresScoresStore } from './internal/scores-store';
import { MatchCentreController } from './match-centre.controller';
import { ScoresController } from './scores.controller';
import { DEFAULT_STREAM_OPTIONS, STREAM_OPTIONS, StreamController } from './stream.controller';

/**
 * The fixtures boundary (02-architecture.md): matches, incidents, lineups,
 * statistics and coverage. Its read side: the scores list (T-030), the match
 * centre (T-033) and the SSE gateway that pushes both (T-032).
 */
@Module({
  imports: [IdentityModule, ProfileModule],
  controllers: [ScoresController, MatchCentreController, StreamController],
  providers: [
    FixturesService,
    PostgresScoresStore,
    PostgresMatchCentreStore,
    FixtureChangeFeed,
    // Provided here so a test can override the timings.
    { provide: STREAM_OPTIONS, useValue: DEFAULT_STREAM_OPTIONS },
  ],
  exports: [FixturesService],
})
export class FixturesModule {}
