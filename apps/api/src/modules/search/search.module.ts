import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { MediaModule } from '../media/media.module';
import { PostgresCommunitySearchStore } from './internal/community-search-store';
import { PostgresSearchStore } from './internal/search-store';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * The search boundary (02-architecture.md): entity search over the catalog
 * and aliases (T-038), and stories, groups and members (T-642). Identity only
 * tells the controller who is asking; media gives each entity its image from
 * our own origin (T-1617).
 */
@Module({
  imports: [IdentityModule, MediaModule],
  controllers: [SearchController],
  providers: [SearchService, PostgresSearchStore, PostgresCommunitySearchStore],
  exports: [SearchService],
})
export class SearchModule {}
