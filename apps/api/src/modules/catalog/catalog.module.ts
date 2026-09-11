import { Module } from '@nestjs/common';
import { StandingsModule } from '../standings/standings.module';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';
import { PostgresCompetitionStore } from './internal/competition-store';

/**
 * The catalog boundary's read side: summary lists for forms, and the
 * competition page (T-035), whose table and leaders come from the standings
 * boundary.
 */
@Module({
  imports: [StandingsModule],
  controllers: [CatalogController],
  providers: [CatalogService, PostgresCompetitionStore],
  exports: [CatalogService],
})
export class CatalogModule {}
