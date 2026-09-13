import { Module } from '@nestjs/common';
import { ForecastModule } from '../forecast/forecast.module';
import { StandingsModule } from '../standings/standings.module';
import { CoverageService } from './coverage.service';
import { IngestRunsService } from './ingest-runs.service';
import { IngestionController } from './ingestion.controller';
import { IngestionJobsService } from './ingestion-jobs.service';
import { IngestionSchedulerService } from './ingestion-scheduler.service';
import { EntityResolverService } from './ingestion.service';
import { PostgresRunStore } from './internal/run-store';
import { INGESTION_SOURCES, resolveSources } from './internal/sources';

/**
 * The ingestion boundary (02-architecture.md). Owns `provider_mapping`,
 * `ingest_run` and `unresolved_entity`: the entity resolver (T-013), the run
 * recorder and the ingestion health view (T-071), and the scheduled jobs and
 * the source they run against (T-026, D-049), and the coverage profile computed
 * from what those jobs actually wrote (T-027).
 *
 * The sources are resolved once, from the environment, at module construction;
 * `INGESTION_SOURCE` picks the profile and `INGESTION_SCHEDULE` decides whether
 * this process polls. The standings boundary is imported for its public
 * service alone: the standings job compares the provider's table against the
 * one we derive (D-038), and writes nothing. The forecast boundary is imported
 * for the same reason: the scheduler gives its version triggers (T-120) a tick
 * of their own, because producing a forecast is not ingestion and must not
 * appear in `ingest_run`. `PG_POOL` comes from the global
 * `DatabaseModule`.
 */
@Module({
  imports: [StandingsModule, ForecastModule],
  controllers: [IngestionController],
  providers: [
    EntityResolverService,
    IngestRunsService,
    PostgresRunStore,
    CoverageService,
    IngestionJobsService,
    IngestionSchedulerService,
    { provide: INGESTION_SOURCES, useFactory: () => resolveSources(process.env) },
  ],
  exports: [EntityResolverService, IngestRunsService, IngestionJobsService, CoverageService],
})
export class IngestionModule {}
