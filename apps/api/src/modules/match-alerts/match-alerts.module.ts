import { Module } from '@nestjs/common';
import { FailureCountsModule } from '../failure-counts/failure-counts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { MatchAlertsStore } from './internal/match-alerts-store';
import { MatchAlertsService } from './match-alerts.service';

/**
 * Match alerts (blueprint 12.2, T-830, D-098). Imported by the ingestion
 * boundary, whose live and post-match jobs hand it the readings; it imports
 * notifications, which imports no producer, and failure counts (for its
 * queue's worker, T-835), which imports only identity, so the arrow runs one
 * way: ingestion → match alerts → notifications.
 */
@Module({
  imports: [NotificationsModule, FailureCountsModule],
  providers: [MatchAlertsService, MatchAlertsStore],
  exports: [MatchAlertsService],
})
export class MatchAlertsModule {}
