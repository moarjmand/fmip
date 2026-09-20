import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { CampaignsController } from './campaigns.controller';
import { CampaignsService } from './campaigns.service';
import { PostgresCampaignStore } from './internal/campaign-store';

/**
 * Campaigns (T-332, D-075): an audience is a saved query, a send is a row.
 * Reaches members only through the notifications module's own `emit()`, so
 * every rule the inbox has applies; nothing imports it.
 */
@Module({
  imports: [IdentityModule, NotificationsModule],
  controllers: [CampaignsController],
  providers: [PostgresCampaignStore, CampaignsService],
})
export class CampaignsModule {}
