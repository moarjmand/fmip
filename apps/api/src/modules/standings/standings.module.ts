import { Module } from '@nestjs/common';
import { PostgresStandingsStore } from './internal/standings-store';
import { StandingsService } from './standings.service';

/**
 * The standings boundary (02-architecture.md): tables and leaders computed
 * from stored results (T-035). No controller of its own: the competition
 * page (catalog) and, later, the team page read it.
 */
@Module({
  providers: [StandingsService, PostgresStandingsStore],
  exports: [StandingsService],
})
export class StandingsModule {}
