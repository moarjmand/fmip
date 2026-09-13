import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ModerationAdminController } from './moderation-admin.controller';
import { ModerationController } from './moderation.controller';
import { ModerationService } from './moderation.service';

/**
 * The moderation boundary (blueprint 10.4, D-053).
 *
 * It imports the identity module's public service to know who is asking, and
 * nothing else. The dependency runs the other way where it matters: the social
 * boundary asks this one to explain a refusal the database has already made,
 * which keeps "what is this member restricted from" in one place without the
 * two boundaries importing each other.
 */
@Module({
  imports: [IdentityModule],
  controllers: [ModerationController, ModerationAdminController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}
