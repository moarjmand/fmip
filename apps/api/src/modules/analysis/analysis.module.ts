import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AnalysisController } from './analysis.controller';
import { AnalysisService } from './analysis.service';
import { PostgresAnalysisStore } from './internal/analysis-store';

/**
 * Community-written match analysis (blueprint 10.3, E26).
 *
 * **Its own boundary, and that is the epic's whole argument.** The obvious
 * alternative is a second author on the founder's analysis, and it would make
 * the founder's signature mean nothing (rule 6). So this module shares no table,
 * no type and no service with `FounderModule`, and the two never import each
 * other.
 *
 * It imports identity to know who is asking and notifications to tell an analyst
 * what was decided. It does not import reputation: whether the author holds a
 * contributor grant is asked by a trigger (`PL014`), and importing a service to
 * answer a question a row already answers would be a second copy of the gate.
 */
@Module({
  imports: [IdentityModule, NotificationsModule],
  controllers: [AnalysisController],
  providers: [AnalysisService, PostgresAnalysisStore],
  exports: [AnalysisService],
})
export class AnalysisModule {}
