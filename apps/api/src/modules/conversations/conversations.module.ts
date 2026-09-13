import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ModerationModule } from '../moderation/moderation.module';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';

/**
 * The conversations boundary (blueprint 8.3, T-221).
 *
 * It imports identity to know who is asking and moderation to explain a
 * refusal the database has already made (SQLSTATE PL004) -- never to decide
 * one. It does not import the social boundary: whether two members are friends
 * is one `friendship` lookup on the shared schema, and asking a service for it
 * would import a second boundary to answer a question one row already answers.
 */
@Module({
  imports: [IdentityModule, ModerationModule],
  controllers: [ConversationsController],
  providers: [ConversationsService],
  exports: [ConversationsService],
})
export class ConversationsModule {}
