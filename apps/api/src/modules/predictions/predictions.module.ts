import { Module } from '@nestjs/common';
import { GroupsModule } from '../groups/groups.module';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProfileModule } from '../profile/profile.module';
import { SocialModule } from '../social/social.module';
import { HistoryController } from './history.controller';
import { PostgresPendingPickStore } from './internal/pending-pick-store';
import { PostgresPredictionStore } from './internal/prediction-store';
import { PostgresSettlementStore } from './internal/settlement-store';
import { PostgresShareStore } from './internal/share-store';
import { PendingPickController } from './pending-pick.controller';
import { PendingPickService } from './pending-pick.service';
import { PredictionShareController } from './prediction-share.controller';
import { PredictionShareService } from './prediction-share.service';
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
  // Social and notifications tell a member's friends they predicted (T-832).
  imports: [IdentityModule, ProfileModule, GroupsModule, SocialModule, NotificationsModule],
  controllers: [
    PredictionsController,
    SettlementController,
    HistoryController,
    // A public link to one correct prediction's card (T-1723, D-351).
    PredictionShareController,
    // A pick made before the e-mail address is confirmed (T-1740, D-361):
    // its own table and service, a prediction only through `PredictionsService`.
    PendingPickController,
  ],
  providers: [
    PredictionsService,
    PostgresPredictionStore,
    PendingPickService,
    PostgresPendingPickStore,
    SettlementService,
    PostgresSettlementStore,
    PredictionShareService,
    PostgresShareStore,
  ],
  exports: [PredictionsService, SettlementService],
})
export class PredictionsModule {}
