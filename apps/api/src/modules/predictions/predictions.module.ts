import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PostgresPredictionStore } from './internal/prediction-store';
import { PredictionsController } from './predictions.controller';
import { PredictionsService } from './predictions.service';

/**
 * The predictions boundary (02-architecture.md): user predictions, locking
 * (T-051) and settlement (T-052). Today: submission as immutable versions.
 */
@Module({
  imports: [IdentityModule],
  controllers: [PredictionsController],
  providers: [PredictionsService, PostgresPredictionStore],
  exports: [PredictionsService],
})
export class PredictionsModule {}
