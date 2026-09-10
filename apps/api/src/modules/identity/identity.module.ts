import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  IdentityService,
  type IdentityOptions,
} from './identity.service';
import { PostgresIdentityStore } from './internal/identity-store';
import { LogMailer, MAILER } from './internal/mailer';
import { sessionSecretFromEnv } from './internal/tokens';

/** Options from the environment. Refuses a missing or weak SESSION_SECRET. */
export function identityOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): IdentityOptions {
  return {
    ...DEFAULT_IDENTITY_OPTIONS,
    sessionSecret: sessionSecretFromEnv(env),
    webBaseUrl: (env.WEB_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, ''),
    cookieSecure: env.NODE_ENV === 'production',
  };
}

/**
 * The identity boundary (02-architecture.md): users, credentials, sessions,
 * roles. Mail goes through the `MAILER` port; `LogMailer` prints it until a
 * provider is chosen at deployment (D-026).
 */
@Module({
  controllers: [IdentityController],
  providers: [
    IdentityService,
    PostgresIdentityStore,
    { provide: IDENTITY_OPTIONS, useFactory: (): IdentityOptions => identityOptionsFromEnv() },
    { provide: MAILER, useClass: LogMailer },
  ],
  exports: [IdentityService],
})
export class IdentityModule {}
