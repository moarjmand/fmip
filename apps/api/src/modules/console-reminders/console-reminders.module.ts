import { Module } from '@nestjs/common';
import { AgentsConsoleModule } from '../agents-console/agents-console.module';
import { DeliveryModule } from '../delivery/delivery.module';
import { FailureCountsModule } from '../failure-counts/failure-counts.module';
import { ConsoleRemindersController } from './console-reminders.controller';
import { ConsoleRemindersScheduler } from './console-reminders-scheduler.service';
import { ConsoleRequestAlerts } from './console-request-alerts.service';
import { ConsoleReminders } from './console-reminders.service';

/**
 * The agents console calendar's reminders (T-1788, D-391): the minute run
 * that sends them by Web Push and the routes that switch a browser on. Apart
 * from `agents-console` so that module's command-line tool needs no push
 * channel and starts no queue. Owns no table: the calendar's are the
 * console's, through its public `ConsoleCalendarService`.
 */
@Module({
  imports: [AgentsConsoleModule, DeliveryModule, FailureCountsModule],
  controllers: [ConsoleRemindersController],
  // T-1832 (D-425): new teammate requests, by the same push channel and browsers.
  providers: [ConsoleReminders, ConsoleRemindersScheduler, ConsoleRequestAlerts],
})
export class ConsoleRemindersModule {}
