import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FounderFeedController } from './founder-feed.controller';
import { FounderAnalysisController } from './founder.controller';
import { FounderAnalysisService } from './founder.service';

/**
 * The founder's analysis boundary (blueprint 6.5, T-131).
 *
 * Its own module rather than a corner of the forecast one, and that is the
 * point: the statistical model and the founder's analysis are two of the three
 * prediction products, and keeping them in separate boundaries is what makes
 * blending them a deliberate act rather than an accident (rule 6). It imports
 * identity for the `founder` role check, and notifications to tell a match's
 * followers an analysis was published (T-833).
 */
@Module({
  imports: [IdentityModule, NotificationsModule],
  controllers: [FounderAnalysisController, FounderFeedController],
  providers: [FounderAnalysisService],
  exports: [FounderAnalysisService],
})
export class FounderModule {}
