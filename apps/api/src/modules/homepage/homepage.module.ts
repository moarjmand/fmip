import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { HomepageFeatureController } from './homepage-feature.controller';
import { PostgresFeatureStore } from './internal/feature-store';

/**
 * The homepage's editorial placement (T-1161, D-153): which matches an editor
 * features, and for how long. It reads `fixture` for a match's state and
 * names, and owns `homepage_feature`; nothing else writes it. Imports
 * identity only (who is asking, and whether they hold the role).
 */
@Module({
  imports: [IdentityModule],
  controllers: [HomepageFeatureController],
  providers: [PostgresFeatureStore],
})
export class HomepageModule {}
