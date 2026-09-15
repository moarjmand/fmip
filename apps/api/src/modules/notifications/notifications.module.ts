import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { PostgresNotificationsStore } from './internal/notifications-store';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * In-product notifications (blueprint 12.2, E27).
 *
 * **It imports nothing**, and that is what makes it safe for every other module
 * to import. A notification is a consequence of something that happened
 * elsewhere, so the boundary that records consequences must not depend on the
 * boundaries that produce them -- the arrows go one way, and a cycle here would
 * be a cycle between almost every module in the product.
 *
 * The cost is that this module knows nothing about what it is describing: it
 * takes ids and kinds, not fixtures and conversations, and the deep link is
 * resolved by whoever reads the inbox (T-272).
 */
@Module({
  // Identity, and only identity: the inbox has to know who is asking, and
  // nothing else about the product. Importing a producer here would be the
  // cycle this module exists to avoid.
  imports: [IdentityModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, PostgresNotificationsStore],
  exports: [NotificationsService],
})
export class NotificationsModule {}
