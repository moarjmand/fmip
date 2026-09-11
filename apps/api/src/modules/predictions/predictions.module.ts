import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PostgresPredictionStore } from './internal/prediction-store';
import { PostgresSettlementStore } from './internal/settlement-store';
import { PredictionsController } from './predictions.controller';
import { PredictionsService } from './predictions.service';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';

/**
 * The predictions boundary (02-architecture.md): user predictions, locking
 * (T-051) and settlement (T-052).
 */
@Module({
  imports: [IdentityModule],
  controllers: [PredictionsController, SettlementController],
  providers: [
    PredictionsService,
    PostgresPredictionStore,
    SettlementService,
    PostgresSettlementStore,
  ],
  exports: [PredictionsService, SettlementService],
})
export class PredictionsModule {}
