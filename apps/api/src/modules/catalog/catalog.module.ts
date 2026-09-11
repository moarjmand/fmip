import { Module } from '@nestjs/common';
import { StandingsModule } from '../standings/standings.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { PostgresCompetitionStore } from './internal/competition-store';
import { PostgresPlayerStore } from './internal/player-store';
import { PostgresTeamStore } from './internal/team-store';

/**
 * The catalog boundary's read side: summary lists for forms, the competition
 * page (T-035), the team page (T-036) and the player page (T-037). Tables
 * come from the standings boundary.
 */
@Module({
  imports: [StandingsModule],
  controllers: [CatalogController],
  providers: [CatalogService, PostgresCompetitionStore, PostgresTeamStore, PostgresPlayerStore],
  exports: [CatalogService],
})
export class CatalogModule {}
