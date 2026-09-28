import { Module } from '@nestjs/common';
import { FailureCountsModule } from '../failure-counts/failure-counts.module';
import { IdentityModule } from '../identity/identity.module';
import { DataQualityController } from './data-quality.controller';
import { DataQualitySchedulerService } from './data-quality-scheduler.service';
import { DataQualityService } from './data-quality.service';
import { DataQualityStore } from './internal/data-quality-store';

/**
 * Data-quality checks over the stored feed (T-820, E82) and their admin
 * surface (T-821). Reads the feed's tables and owns `data_quality_finding`
 * and `data_quality_check_run`. Imports nothing that imports it back, so the
 * ingestion boundary can hand it the standings job's table comparison and
 * the watchdog can read it; identity is for the admin gate.
 */
@Module({
  imports: [FailureCountsModule, IdentityModule],
  controllers: [DataQualityController],
  providers: [DataQualityStore, DataQualityService, DataQualitySchedulerService],
  exports: [DataQualityService],
})
export class DataQualityModule {}
