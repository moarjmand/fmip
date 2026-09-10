import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { CatalogModule } from './modules/catalog/catalog.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';
import { ProfileModule } from './modules/profile/profile.module';

/**
 * The remaining modules from `docs/02-architecture.md` are registered here as
 * they are built. Their directories exist under `src/modules/` already so that
 * the boundary is visible before any code fills it in. `DatabaseModule` is not
 * a boundary: it is the shared `pg` pool every boundary injects.
 */
@Module({
  imports: [
    DatabaseModule,
    HealthModule,
    CatalogModule,
    IngestionModule,
    IdentityModule,
    ProfileModule,
  ],
})
export class AppModule {}
