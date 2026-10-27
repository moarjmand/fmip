import { Module } from '@nestjs/common';
import { PostgresUpsetStore } from './internal/upset-store';
import { ModelUpsetController } from './model-upset.controller';
import { ModelUpsetService } from './model-upset.service';

/**
 * The home page's "forecast against reality" card (T-1507, D-265): reads
 * `fixture`, `fixture_score`, `coverage_profile` and the published `forecast`
 * versions, and owns no table. Imports nothing but the global database pool.
 */
@Module({
  controllers: [ModelUpsetController],
  providers: [PostgresUpsetStore, ModelUpsetService],
  exports: [ModelUpsetService],
})
export class ModelUpsetModule {}
