import { Module } from '@nestjs/common';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './modules/health/health.module';
import { IdentityModule } from './modules/identity/identity.module';
import { IngestionModule } from './modules/ingestion/ingestion.module';

/**
 * The remaining modules from `docs/02-architecture.md` are registered here as
 * they are built. Their directories exist under `src/modules/` already so that
 * the boundary is visible before any code fills it in. `DatabaseModule` is not
 * a boundary: it is the shared `pg` pool every boundary injects.
 */
@Module({
  imports: [DatabaseModule, HealthModule, IngestionModule, IdentityModule],
})
export class AppModule {}
