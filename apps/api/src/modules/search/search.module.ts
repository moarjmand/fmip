import { Module } from '@nestjs/common';
import { PostgresSearchStore } from './internal/search-store';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/** The search boundary (02-architecture.md): entity search over the catalog and aliases (T-038). */
@Module({
  controllers: [SearchController],
  providers: [SearchService, PostgresSearchStore],
  exports: [SearchService],
})
export class SearchModule {}
