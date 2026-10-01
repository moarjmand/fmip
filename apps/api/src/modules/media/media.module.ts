import { Module } from '@nestjs/common';
import { FailureCountsModule } from '../failure-counts/failure-counts.module';
import { MediaController } from './media.controller';
import {
  DEFAULT_MEDIA_PACE,
  MEDIA_FETCH,
  MEDIA_FILES,
  MEDIA_PACE,
  MediaFetchService,
  httpMediaFetch,
  mediaFilesFromEnv,
} from './media-fetch.service';
import { MediaSchedulerService } from './media-scheduler.service';
import { MediaService } from './media.service';

/**
 * The media boundary (T-1320, D-176): crests, logos and player photos copied
 * from the provider to our own volume (`MEDIA_DIR`) and served from our own
 * origin. Owns `entity_media`. Exports only `MediaService`: ingestion notes
 * addresses through it, the read modules ask it for our own addresses. The
 * fetch, the files and the pace are providers so a test can replace them.
 */
@Module({
  imports: [FailureCountsModule],
  controllers: [MediaController],
  providers: [
    MediaService,
    MediaFetchService,
    MediaSchedulerService,
    { provide: MEDIA_FETCH, useValue: httpMediaFetch },
    { provide: MEDIA_FILES, useFactory: () => mediaFilesFromEnv(process.env) },
    { provide: MEDIA_PACE, useValue: DEFAULT_MEDIA_PACE },
  ],
  exports: [MediaService],
})
export class MediaModule {}
