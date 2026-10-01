import { Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { LocalisedNamesInterceptor } from './localised-names.interceptor';
import { LocalisedNamesService } from './localised-names.service';

/**
 * Localised names on every surface (T-1312): reads `entity_alias` name rows
 * (T-303) and `country`, writes nothing. Registers the global `?locale=`
 * interceptor and exports the service for the live streams, which answer
 * through the raw reply and so localise their own snapshots.
 */
@Module({
  providers: [
    LocalisedNamesService,
    { provide: APP_INTERCEPTOR, useClass: LocalisedNamesInterceptor },
  ],
  exports: [LocalisedNamesService],
})
export class LocalisedNamesModule {}
