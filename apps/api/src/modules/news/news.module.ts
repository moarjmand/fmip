import { Module } from '@nestjs/common';
import { FetchTransport, NEWS_TRANSPORT } from './internal/news-transport';
import { PostgresNewsStore } from './internal/news-store';
import { NewsIngestionService } from './news-ingestion.service';
import { NewsSchedulerService } from './news-scheduler.service';

/**
 * News (blueprint 3.3, E14): publishers' feeds read as headline and link
 * under the rights each source grants (D-061). Its own boundary because news
 * is not on the critical path (rule 9): a match, its score and its forecast
 * never depend on anything here, and this module imports none of them. The
 * transport is a provider so a spec can script every response.
 */
@Module({
  providers: [
    PostgresNewsStore,
    NewsIngestionService,
    NewsSchedulerService,
    { provide: NEWS_TRANSPORT, useFactory: (): FetchTransport => new FetchTransport() },
  ],
  exports: [NewsIngestionService],
})
export class NewsModule {}
