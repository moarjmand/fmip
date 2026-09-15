import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { GroupsController } from './groups.controller';
import { GroupsService } from './groups.service';

/**
 * The groups boundary (blueprint 8.2 and the exclusive groups of 10.1, T-241).
 *
 * It imports identity to know who is asking, and nothing else. It does not
 * import moderation: a sanction is refused by the database (`PL004`) and this
 * boundary only repeats the refusal. It does not import the social boundary
 * either — whether a block stands between two members is one `users_blocked`
 * call inside a trigger, and asking a service for it would import a second
 * boundary to answer a question a row already answers.
 */
@Module({
  imports: [IdentityModule, NotificationsModule],
  controllers: [GroupsController],
  providers: [GroupsService],
  exports: [GroupsService],
})
export class GroupsModule {}
