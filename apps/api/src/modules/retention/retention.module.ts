import { Module } from '@nestjs/common';
import { FailureCountsModule } from '../failure-counts/failure-counts.module';
import { RetentionStore } from './internal/retention-store';
import { RetentionSchedulerService } from './retention-scheduler.service';
import { RetentionService } from './retention.service';

/**
 * Retention periods and the daily purge (T-1715, D-345). Owns
 * `notification_delivery_daily`; deletes from `session`, `console_session`,
 * `email_token` and `notification_delivery` only the rows whose period is
 * over. No controller: the purge has no surface of its own, and its counts
 * are in the log (`retention.purged`).
 */
@Module({
  imports: [FailureCountsModule],
  providers: [RetentionStore, RetentionService, RetentionSchedulerService],
  exports: [RetentionService],
})
export class RetentionModule {}
