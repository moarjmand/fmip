import { Module } from '@nestjs/common';
import { FailureCountsModule } from '../failure-counts/failure-counts.module';
import { DataQualitySchedulerService } from './data-quality-scheduler.service';
import { DataQualityService } from './data-quality.service';
import { DataQualityStore } from './internal/data-quality-store';

/**
 * Data-quality checks over the stored feed (T-820, E82). Reads the feed's
 * tables and owns `data_quality_finding`. Imports nothing that imports it
 * back, so the ingestion boundary can hand it the standings job's table
 * comparison and the watchdog can read it.
 */
@Module({
  imports: [FailureCountsModule],
  providers: [DataQualityStore, DataQualityService, DataQualitySchedulerService],
  exports: [DataQualityService],
})
export class DataQualityModule {}
