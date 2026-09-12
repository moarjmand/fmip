import { Module } from '@nestjs/common';
import { IngestRunsService } from './ingest-runs.service';
import { IngestionController } from './ingestion.controller';
import { EntityResolverService } from './ingestion.service';
import { PostgresRunStore } from './internal/run-store';

/**
 * The ingestion boundary (02-architecture.md). Owns `provider_mapping`,
 * `ingest_run` and `unresolved_entity`. Adapters and jobs arrive with E2; for
 * now the module is the entity resolver, the run recorder and the ingestion
 * health view (T-071). `PG_POOL` comes from the global `DatabaseModule`, so
 * nothing is imported here.
 */
@Module({
  controllers: [IngestionController],
  providers: [EntityResolverService, IngestRunsService, PostgresRunStore],
  exports: [EntityResolverService, IngestRunsService],
})
export class IngestionModule {}
