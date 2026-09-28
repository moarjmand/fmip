import { Module } from '@nestjs/common';
import { DataQualityModule } from '../data-quality/data-quality.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { FailureCountsModule } from '../failure-counts/failure-counts.module';
import { ForecastModule } from '../forecast/forecast.module';
import { IdentityModule } from '../identity/identity.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ALERT_CURSOR, AdminAlertsService } from './admin-alerts.service';
import { PostgresAlertCursor } from './internal/alert-cursor';
import { LiveProbes, WATCHDOG_PROBES } from './internal/probes';
import { WatchdogStore } from './internal/watchdog-store';
import { WatchdogController } from './watchdog.controller';
import { WatchdogSchedulerService } from './watchdog-scheduler.service';
import { WatchdogService } from './watchdog.service';

/**
 * The watchdog (T-801, E80): a scheduled job over the health views that keeps
 * each condition's state and logs a transition only when a level changes.
 * Reads the ingestion, forecast, delivery and data-quality boundaries through their public
 * services; its own SQL reads the live fixtures and the delivery outcomes, and
 * owns `watchdog_condition` and `watchdog_event`.
 *
 * Its alerts reach administrators through the notifications boundary (T-802):
 * a `system_alert` per `raised`/`recovered` event, behind a cursor it owns
 * (`watchdog_alert_cursor`).
 */
@Module({
  imports: [
    IngestionModule,
    ForecastModule,
    DeliveryModule,
    IdentityModule,
    FailureCountsModule,
    NotificationsModule,
    DataQualityModule,
  ],
  controllers: [WatchdogController],
  providers: [
    WatchdogStore,
    WatchdogService,
    WatchdogSchedulerService,
    AdminAlertsService,
    PostgresAlertCursor,
    { provide: ALERT_CURSOR, useExisting: PostgresAlertCursor },
    LiveProbes,
    { provide: WATCHDOG_PROBES, useExisting: LiveProbes },
  ],
  exports: [WatchdogService],
})
export class WatchdogModule {}
