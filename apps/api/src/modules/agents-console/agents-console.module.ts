import { Module } from '@nestjs/common';
import { sessionSecretFromEnv } from '../identity/identity.service';
import {
  AgentsConsoleController,
  CONSOLE_OPTIONS,
  type ConsoleOptions,
} from './agents-console.controller';
import { PostgresConsoleStore } from './internal/console-store';
import { PostgresRequestStore } from './internal/request-store';

/**
 * The agents console (T-1696, T-1697, D-340): owns the `console_*` tables.
 * Imports nothing of another module's but identity's password and token
 * helpers, through its public file; nothing else reads these tables.
 */
@Module({
  controllers: [AgentsConsoleController],
  providers: [
    PostgresConsoleStore,
    PostgresRequestStore,
    {
      provide: CONSOLE_OPTIONS,
      useFactory: (): ConsoleOptions => ({
        secret: sessionSecretFromEnv(),
        cookieSecure: process.env.NODE_ENV === 'production',
      }),
    },
  ],
  exports: [PostgresConsoleStore, PostgresRequestStore],
})
export class AgentsConsoleModule {}
