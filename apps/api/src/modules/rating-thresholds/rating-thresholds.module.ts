import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PostgresRatingThresholdStore } from './internal/threshold-store';
import { RatingThresholdsController } from './rating-thresholds.controller';
import { RatingThresholdsService } from './rating-thresholds.service';

/**
 * Rating thresholds as versioned rows (T-1160, D-152, D-164): owns
 * `rating_threshold_version`. Imports identity only (who is asking, and
 * whether they are an administrator), so the reputation and administration
 * boundaries can both read the version in force without importing each other.
 */
@Module({
  imports: [IdentityModule],
  controllers: [RatingThresholdsController],
  providers: [RatingThresholdsService, PostgresRatingThresholdStore],
  exports: [RatingThresholdsService],
})
export class RatingThresholdsModule {}
