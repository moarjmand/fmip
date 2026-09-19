import { Module } from '@nestjs/common';
import { DeliveryModule } from '../delivery/delivery.module';
import { DeliveryService } from '../delivery/delivery.service';
import { IdentityController } from './identity.controller';
import {
  DEFAULT_IDENTITY_OPTIONS,
  IDENTITY_OPTIONS,
  IdentityService,
  type IdentityOptions,
} from './identity.service';
import { PostgresIdentityStore } from './internal/identity-store';
import { DeliveryMailer } from './internal/delivery-mailer';
import { MAILER } from './internal/mailer';
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
 * roles. Mail goes through the `MAILER` port, which since D-073 is the
 * delivery port's e-mail channel -- the same one every notification leaves
 * by -- and prints the message where the deployment has none (D-026), so
 * local development still finds the verification link in the terminal.
 */
@Module({
  imports: [DeliveryModule],
  controllers: [IdentityController],
  providers: [
    IdentityService,
    PostgresIdentityStore,
    { provide: IDENTITY_OPTIONS, useFactory: (): IdentityOptions => identityOptionsFromEnv() },
    {
      provide: MAILER,
      useFactory: (delivery: DeliveryService): DeliveryMailer => new DeliveryMailer(delivery),
      inject: [DeliveryService],
    },
  ],
  exports: [IdentityService],
})
export class IdentityModule {}
