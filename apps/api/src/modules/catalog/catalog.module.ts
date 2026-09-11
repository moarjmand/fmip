import { Module } from '@nestjs/common';
import { StandingsModule } from '../standings/standings.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { PostgresCompetitionStore } from './internal/competition-store';
import { PostgresTeamStore } from './internal/team-store';

/**
 * The catalog boundary's read side: summary lists for forms, the competition
 * page (T-035) and the team page (T-036), whose tables come from the
 * standings boundary.
 */
@Module({
  imports: [StandingsModule],
  controllers: [CatalogController],
  providers: [CatalogService, PostgresCompetitionStore, PostgresTeamStore],
  exports: [CatalogService],
})
export class CatalogModule {}
