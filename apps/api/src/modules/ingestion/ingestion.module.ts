import { Module } from '@nestjs/common';
import { EntityResolverService } from './ingestion.service';

/**
 * The ingestion boundary (02-architecture.md). Owns `provider_mapping`,
 * `ingest_run` and `unresolved_entity`. Adapters and jobs arrive with E2; for
 * now the module is the entity resolver. `PG_POOL` comes from the global
 * `DatabaseModule`, so nothing is imported here.
 */
@Module({
  providers: [EntityResolverService],
  exports: [EntityResolverService],
})
export class IngestionModule {}
