import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { FounderAnalysisController } from './founder.controller';
import { FounderAnalysisService } from './founder.service';

/**
 * The founder's analysis boundary (blueprint 6.5, T-131).
 *
 * Its own module rather than a corner of the forecast one, and that is the
 * point: the statistical model and the founder's analysis are two of the three
 * prediction products, and keeping them in separate boundaries is what makes
 * blending them a deliberate act rather than an accident (rule 6). It imports
 * identity for the `founder` role check and nothing else.
 */
@Module({
  imports: [IdentityModule],
  controllers: [FounderAnalysisController],
  providers: [FounderAnalysisService],
  exports: [FounderAnalysisService],
})
export class FounderModule {}
