import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
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
 *
 * It imports groups for the comparison inside a group (T-246), this way round
 * for the reason D-060 gives: groups needs one answer from here and this
 * boundary needs one from there, and groups is the lighter of the two to
 * inherit. Groups answers `audience()` and ranks and scores nothing.
 */
@Module({
  imports: [IdentityModule, ProfileModule, GroupsModule],
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
