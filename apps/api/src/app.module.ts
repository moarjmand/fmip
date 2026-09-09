import { Module } from '@nestjs/common';
import { HealthModule } from './modules/health/health.module';

/**
 * The ten remaining modules from `docs/02-architecture.md` are registered here
 * as they are built. Their directories exist under `src/modules/` already so
 * that the boundary is visible before any code fills it in.
 */
@Module({
  imports: [HealthModule],
})
export class AppModule {}
