import { Module } from '@nestjs/common';
import { sessionSecretFromEnv } from '../identity/identity.service';
import {
  AgentsConsoleController,
  CONSOLE_OPTIONS,
  type ConsoleOptions,
} from './agents-console.controller';
import { ConsoleCalendarController } from './console-calendar.controller';
import { ConsoleCalendarService } from './console-calendar.service';
import { ConsoleSessions } from './console-sessions.service';
import { PostgresCalendarStore } from './internal/calendar-store';
import { PostgresConsoleStore } from './internal/console-store';
import { PostgresRequestStore } from './internal/request-store';
import { ImageBodyParser } from './internal/image-body';
import {
  REQUEST_IMAGE_FILES,
  RequestImageFiles,
  consoleMediaDir,
} from './internal/request-image-files';

/**
 * The agents console (T-1696, T-1697, D-340): owns the `console_*` tables.
 * Imports nothing of another module's but identity's password and token
 * helpers, through its public file; nothing else reads these tables.
 */
@Module({
  controllers: [AgentsConsoleController, ConsoleCalendarController],
  providers: [
    PostgresConsoleStore,
    PostgresRequestStore,
    // T-1788 (D-391): the calendar and its reminders' devices.
    PostgresCalendarStore,
    ConsoleCalendarService,
    // T-1729: the session check, for the model page another module serves.
    ConsoleSessions,
    // T-1731 (D-357): the requests' pictures, private on the media volume.
    ImageBodyParser,
    {
      provide: REQUEST_IMAGE_FILES,
      useFactory: (): RequestImageFiles => new RequestImageFiles(consoleMediaDir()),
    },
    {
      provide: CONSOLE_OPTIONS,
      useFactory: (): ConsoleOptions => ({
        secret: sessionSecretFromEnv(),
        cookieSecure: process.env.NODE_ENV === 'production',
      }),
    },
  ],
  exports: [
    PostgresConsoleStore,
    PostgresRequestStore,
    PostgresCalendarStore,
    ConsoleCalendarService,
    ConsoleSessions,
    REQUEST_IMAGE_FILES,
  ],
})
export class AgentsConsoleModule {}
