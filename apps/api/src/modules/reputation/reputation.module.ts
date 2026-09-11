import { Module } from '@nestjs/common';
import { ForecastModule } from '../forecast/forecast.module';
import { IdentityModule } from '../identity/identity.module';
import { PredictionsModule } from '../predictions/predictions.module';
import { CareerPointsService } from './career-points.service';
import { PostgresPointsStore } from './internal/points-store';
import { PostgresRatingStore } from './internal/rating-store';
import { ReputationController } from './reputation.controller';
import { ReputationService } from './reputation.service';

/**
 * The reputation boundary (02-architecture.md): Performance Rating (T-053),
 * Career Points (T-054), leaderboards (T-055).
 */
@Module({
  imports: [IdentityModule, PredictionsModule, ForecastModule],
  controllers: [ReputationController],
  providers: [ReputationService, PostgresRatingStore, CareerPointsService, PostgresPointsStore],
  exports: [ReputationService, CareerPointsService],
})
export class ReputationModule {}
