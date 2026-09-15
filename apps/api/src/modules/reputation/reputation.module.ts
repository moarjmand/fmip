import { Module } from '@nestjs/common';
import { ForecastModule } from '../forecast/forecast.module';
import { GroupsModule } from '../groups/groups.module';
import { IdentityModule } from '../identity/identity.module';
import { PredictionsModule } from '../predictions/predictions.module';
import { CareerPointsService } from './career-points.service';
import { ContributorController } from './contributor.controller';
import { ContributorService } from './contributor.service';
import { PostgresContributorStore } from './internal/contributor-store';
import { PostgresPointsStore } from './internal/points-store';
import { PostgresRatingStore } from './internal/rating-store';
import { ReputationController } from './reputation.controller';
import { ReputationService } from './reputation.service';

/**
 * The reputation boundary (02-architecture.md): Performance Rating (T-053),
 * Career Points (T-054), leaderboards (T-055), contributor approval (T-250).
 *
 * Contributor eligibility lives here because it is computed from the rating and
 * the settled count, which are this boundary's. The **grant** lives here too,
 * and deliberately not in moderation: moderation restricts, and this permits.
 * Sharing a module would have put one team's tables under the other's service.
 *
 * It imports groups for the group board (T-243), and this way round on purpose.
 * Groups needs one answer from here and this boundary needs one answer from
 * there; whichever imports the other gets the other's dependencies, and a group
 * test that has to set `MODEL_SERVICE_URL` to list members would be the wrong
 * one. So groups stays light and answers `audience()`, and the ranking -- every
 * rule of which is here -- stays here.
 */
@Module({
  imports: [IdentityModule, PredictionsModule, ForecastModule, GroupsModule],
  controllers: [ReputationController, ContributorController],
  providers: [
    ReputationService,
    PostgresRatingStore,
    CareerPointsService,
    PostgresPointsStore,
    ContributorService,
    PostgresContributorStore,
  ],
  exports: [ReputationService, CareerPointsService, ContributorService],
})
export class ReputationModule {}
