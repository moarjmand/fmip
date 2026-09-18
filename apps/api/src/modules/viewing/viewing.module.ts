import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ProfileModule } from '../profile/profile.module';
import { PostgresViewingAdminStore } from './internal/viewing-admin-store';
import { PostgresViewingReadStore } from './internal/viewing-read-store';
import { ViewingAdminController } from './viewing-admin.controller';
import { ViewingController } from './viewing.controller';
import { ViewingService } from './viewing.service';

/**
 * Watch and highlights (blueprint 11, E31): where a match can be watched in
 * the viewer's territory and where its highlight is, under the rights each
 * source grants (T-311), from the editorial desk until a licence says
 * otherwise (T-313, D-069). Its own boundary: not on the critical path
 * (rule 9), so a match, its score and its forecast never depend on it, and it
 * imports only identity (who is asking) and profile (their territory).
 */
@Module({
  imports: [IdentityModule, ProfileModule],
  controllers: [ViewingController, ViewingAdminController],
  providers: [PostgresViewingReadStore, PostgresViewingAdminStore, ViewingService],
  exports: [ViewingService],
})
export class ViewingModule {}
