import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { PostgresAdminStore } from './internal/admin-store';

/**
 * The administration boundary (02-architecture.md, T-070): the operator's
 * view across the platform and the audited high-impact writes. Reads the
 * ingestion boundary through its public service; the rating rules through
 * the reputation boundary's public file.
 */
@Module({
  imports: [IdentityModule, IngestionModule],
  controllers: [AdminController],
  providers: [AdminService, PostgresAdminStore],
  exports: [AdminService],
})
export class AdminModule {}
