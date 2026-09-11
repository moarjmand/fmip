import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ProfileModule } from '../profile/profile.module';
import { HistoryController } from './history.controller';
import { PostgresPredictionStore } from './internal/prediction-store';
import { PostgresSettlementStore } from './internal/settlement-store';
import { PredictionsController } from './predictions.controller';
import { PredictionsService } from './predictions.service';
import { SettlementController } from './settlement.controller';
import { SettlementService } from './settlement.service';

/**
 * The predictions boundary (02-architecture.md): user predictions, locking
 * (T-051), settlement (T-052) and the member's history (T-056, whose
 * visibility the profile boundary decides).
 */
@Module({
  imports: [IdentityModule, ProfileModule],
  controllers: [PredictionsController, SettlementController, HistoryController],
  providers: [
    PredictionsService,
    PostgresPredictionStore,
    SettlementService,
    PostgresSettlementStore,
  ],
  exports: [PredictionsService, SettlementService],
})
export class PredictionsModule {}
