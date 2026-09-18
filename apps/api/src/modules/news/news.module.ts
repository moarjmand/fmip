import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ProfileModule } from '../profile/profile.module';
import { PostgresNewsReadStore } from './internal/news-read-store';
import { FetchTransport, NEWS_TRANSPORT } from './internal/news-transport';
import { PostgresNewsStore } from './internal/news-store';
import { NewsClusteringService } from './news-clustering.service';
import { NewsIngestionService } from './news-ingestion.service';
import { NewsSchedulerService } from './news-scheduler.service';
import { NewsController } from './news.controller';

/**
 * News (blueprint 3.3, E14): publishers' feeds read as headline and link
 * under the rights each source grants (D-061). Its own boundary because news
 * is not on the critical path (rule 9): a match, its score and its forecast
 * never depend on anything here, and this module imports none of them. It
 * imports identity (who is asking) and profile (whom they follow) for the
 * following section, through their public services. The transport is a
 * provider so a spec can script every response.
 */
@Module({
  imports: [IdentityModule, ProfileModule],
  controllers: [NewsController],
  providers: [
    PostgresNewsStore,
    PostgresNewsReadStore,
    NewsClusteringService,
    NewsIngestionService,
    NewsSchedulerService,
    { provide: NEWS_TRANSPORT, useFactory: (): FetchTransport => new FetchTransport() },
  ],
  exports: [NewsIngestionService],
})
export class NewsModule {}
