import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { IngestionModule } from '../ingestion/ingestion.module';
import { RatingThresholdsModule } from '../rating-thresholds/rating-thresholds.module';
import { AdminController } from './admin.controller';
import { AdminService } from './admin.service';
import { CompetitionOrderController } from './competition-order.controller';
import { PostgresCompetitionOrderStore } from './internal/competition-order-store';
import { PostgresAdminStore } from './internal/admin-store';

/**
 * The administration boundary (02-architecture.md, T-070): the operator's
 * view across the platform and the audited high-impact writes. Reads the
 * ingestion boundary through its public service; the rating rules through
 * the reputation boundary's public file, under the threshold version in
 * force (T-1160).
 */
@Module({
  imports: [IdentityModule, IngestionModule, RatingThresholdsModule],
  controllers: [AdminController, CompetitionOrderController],
  providers: [AdminService, PostgresAdminStore, PostgresCompetitionOrderStore],
  exports: [AdminService],
})
export class AdminModule {}
