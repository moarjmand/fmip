import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ReputationModule } from '../reputation/reputation.module';
import { PostgresPanelAdminStore } from './internal/panel-admin-store';
import { PostgresPanelSocialStore } from './internal/panel-social-store';
import { PostgresPanelStore } from './internal/panel-store';
import { PanelAdminController } from './panel-admin.controller';
import { PanelSocialController } from './panel-social.controller';
import { PanelSocialService } from './panel-social.service';
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
 *
 * T-252 adds reacting and following to the same boundary, and they sit here
 * rather than in social (T-200) because what they are about is a panel: a
 * reaction hangs on a panel post, and following a contributor is what a reader
 * of a panel does next. What they emphatically do not do is ask this module's
 * own gate -- reacting and following are open to any member, and a check for
 * approval on either would be a second, quieter approval nobody decided to
 * create.
 */
@Module({
  imports: [IdentityModule, ReputationModule, NotificationsModule],
  controllers: [PanelController, PanelSocialController, PanelAdminController],
  providers: [
    PanelService,
    PostgresPanelStore,
    PanelSocialService,
    PostgresPanelSocialStore,
    PostgresPanelAdminStore,
  ],
  exports: [PanelService, PanelSocialService],
})
export class PanelModule {}
