import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { ForecastModule } from '../forecast/forecast.module';
import { IdentityModule } from '../identity/identity.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { LiveProbes, WATCHDOG_PROBES } from './internal/probes';
import { WatchdogStore } from './internal/watchdog-store';
import { WatchdogController } from './watchdog.controller';
import { WatchdogSchedulerService } from './watchdog-scheduler.service';
import { WatchdogService } from './watchdog.service';

/**
 * The watchdog (T-801, E80): a scheduled job over the health views that keeps
 * each condition's state and logs a transition only when a level changes.
 * Reads the ingestion, forecast and delivery boundaries through their public
 * services; its own SQL reads the live fixtures and the delivery outcomes, and
 * owns `watchdog_condition` and `watchdog_event`.
 */
@Module({
  imports: [IngestionModule, ForecastModule, DeliveryModule, IdentityModule],
  controllers: [WatchdogController],
  providers: [
    WatchdogStore,
    WatchdogService,
    WatchdogSchedulerService,
    LiveProbes,
    { provide: WATCHDOG_PROBES, useExisting: LiveProbes },
  ],
  exports: [WatchdogService],
})
export class WatchdogModule {}
