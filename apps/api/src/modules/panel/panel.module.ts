import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ReputationModule } from '../reputation/reputation.module';
import { PostgresPanelStore } from './internal/panel-store';
import { PanelController } from './panel.controller';
import { PanelService } from './panel.service';

/**
 * The public match discussion boundary (blueprint 10.2, T-251).
 *
 * **Its own module rather than a corner of the fixtures one.** A fixture is a
 * football entity; a panel is a place people talk, with a gate, a ceiling and a
 * moderation surface. Putting its SQL under the match centre would have left the
 * football boundary owning a table the moderation team acts on.
 *
 * It imports reputation for `ContributorService` -- the approval it must explain
 * -- and never to decide anything: whether a post may be written is settled by
 * the triggers on `panel_post`, and this boundary asks only so that it can tell
 * a member what would happen.
 */
@Module({
  imports: [IdentityModule, ReputationModule],
  controllers: [PanelController],
  providers: [PanelService, PostgresPanelStore],
  exports: [PanelService],
})
export class PanelModule {}
