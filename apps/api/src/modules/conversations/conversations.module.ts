import { Inject, Module, type OnModuleDestroy } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { ModerationModule } from '../moderation/moderation.module';
import {
  CHAT_GATEWAY_OPTIONS,
  ChatGateway,
  type ChatGatewayOptions,
  DEFAULT_CHAT_GATEWAY_OPTIONS,
} from './chat.gateway';
import { ChatHealthController } from './chat-health.controller';
import { ConversationsController } from './conversations.controller';
import { ConversationsService } from './conversations.service';
import { CHAT_BUS, type ChatBus, chatBusFromEnv } from './internal/chat-bus';

/**
 * Which origins may open a chat socket (T-230).
 *
 * The web origin, and in development the one `next dev` actually serves on when
 * it differs. Nothing is wildcarded: a WebSocket handshake ignores CORS, so this
 * list is the only thing standing between our session cookie and a socket opened
 * by somebody else's page.
 *
 * `CHAT_ALLOWED_ORIGINS` exists for the deployment where the browser reaches the
 * socket through an edge that is not `WEB_BASE_URL` — a preview host, a second
 * domain — and is a comma-separated list.
 */
export function chatOriginsFromEnv(env: NodeJS.ProcessEnv = process.env): string[] {
  const extra = (env.CHAT_ALLOWED_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim().replace(/\/+$/, ''))
    .filter((origin) => origin !== '');
  const web = (env.WEB_BASE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
  return [...new Set([web, ...extra])];
}

/**
 * The conversations boundary (blueprint 8.3, T-221).
 *
 * It imports identity to know who is asking and moderation to explain a
 * refusal the database has already made (SQLSTATE PL004) -- never to decide
 * one. It does not import the social boundary: whether two members are friends
 * is one `friendship` lookup on the shared schema, and asking a service for it
 * would import a second boundary to answer a question one row already answers.
 *
 * `ChatGateway` (T-230) is the same boundary over a socket, and carries
 * delivery only: every write stays on the controller above it. `CHAT_BUS`
 * (T-231) is how one instance's write reaches another instance's socket; with
 * no `REDIS_URL` it is the absent bus, which says so rather than pretending.
 */
@Module({
  imports: [IdentityModule, ModerationModule],
  controllers: [ConversationsController, ChatHealthController],
  providers: [
    ConversationsService,
    ChatGateway,
    { provide: CHAT_BUS, useFactory: (): ChatBus => chatBusFromEnv() },
    {
      provide: CHAT_GATEWAY_OPTIONS,
      useFactory: (): ChatGatewayOptions => ({
        ...DEFAULT_CHAT_GATEWAY_OPTIONS,
        allowedOrigins: chatOriginsFromEnv(),
      }),
    },
  ],
  exports: [ConversationsService, ChatGateway, CHAT_BUS],
})
export class ConversationsModule implements OnModuleDestroy {
  constructor(@Inject(CHAT_BUS) private readonly bus: ChatBus) {}

  /** Redis connections outlive nothing: shutting the app down closes them. */
  async onModuleDestroy(): Promise<void> {
    await this.bus.close();
  }
}
