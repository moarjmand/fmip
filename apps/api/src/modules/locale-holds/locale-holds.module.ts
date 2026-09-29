import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { LocaleHoldsController } from './locale-holds.controller';
import { PostgresLocaleHoldStore } from './internal/locale-hold-store';

/**
 * Holding back a language that is ready (T-1163, D-155): owns `locale_hold`.
 * Imports identity only (who is asking, and whether they are an
 * administrator). The notifications boundary reads the table in SQL for the
 * language a link is made in; nothing else writes it.
 */
@Module({
  imports: [IdentityModule],
  controllers: [LocaleHoldsController],
  providers: [PostgresLocaleHoldStore],
})
export class LocaleHoldsModule {}
