import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { MatchAlertsStore } from './internal/match-alerts-store';
import { MatchAlertsService } from './match-alerts.service';

/**
 * Match alerts (blueprint 12.2, T-830, D-096). Imported by the ingestion
 * boundary, whose live and post-match jobs hand it the readings; it imports
 * only notifications, which imports no producer, so the arrow runs one way:
 * ingestion → match alerts → notifications.
 */
@Module({
  imports: [NotificationsModule],
  providers: [MatchAlertsService, MatchAlertsStore],
  exports: [MatchAlertsService],
})
export class MatchAlertsModule {}
