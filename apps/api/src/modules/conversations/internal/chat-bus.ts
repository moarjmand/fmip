import { Logger } from '@nestjs/common';
import type { ChatEvent } from '@fmip/contracts';
import Redis from 'ioredis';

/**
 * What happened, and where. One shape on the wire between instances.
 */
export interface ChatBroadcast {
  conversation_id: string;
  event: ChatEvent;
}

export type ChatBusListener = (broadcast: ChatBroadcast) => void;

/**
 * The channel between API instances (T-231).
 *
 * **One channel, not one per conversation.** Every instance receives every chat
 * broadcast and drops the ones no local socket is subscribed to. Per-conversation
 * channels would save that filtering, at the price of a Redis subscription table
 * that has to stay in step with the socket registry on every subscribe, leave,
 * disconnect and crash — two sources of truth for who is listening, which is the
 * bug this whole epic is built to avoid. The filter is a `Set.has` per broadcast
 * per instance; the day that is the bottleneck is the day to sharded channels,
 * and `docs/00-decisions.md` (D-056) says so.
 */
export interface ChatBus {
  publish(broadcast: ChatBroadcast): Promise<void>;
  /** Returns the function that stops listening. */
  subscribe(listener: ChatBusListener): Promise<() => void>;
  /** Whether the bus can actually carry anything. T-233 reports it. */
  readonly healthy: boolean;
  close(): Promise<void>;
}

export const CHAT_BUS = Symbol('CHAT_BUS');

/** The one channel, named so it is recognisable in `redis-cli monitor`. */
export const CHAT_CHANNEL = 'fmip:chat';

/**
 * Redis pub/sub, with the two connections Redis requires: a client in subscribe
 * mode may issue nothing else, so publishing needs its own.
 *
 * Delivery is at-most-once and deliberately so. Redis pub/sub drops a message
 * for an instance that is disconnected at that moment, and the answer to that is
 * not a durable queue — it is the sequence number every message already carries:
 * a client that reconnects asks for everything after the last one it holds
 * (T-235). A stream would give us durability we would still have to reconcile,
 * and two mechanisms for the same guarantee is one more than the number that
 * stays correct.
 */
export class RedisChatBus implements ChatBus {
  private readonly log = new Logger('Chat');
  private readonly publisher: Redis;
  private readonly subscriber: Redis;
  private readonly listeners = new Set<ChatBusListener>();
  private listening: Promise<void> | null = null;
  private connected = false;

  constructor(url: string) {
    // `lazyConnect` so constructing the bus never blocks module setup; the
    // first publish or subscribe opens the connection.
    this.publisher = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
    this.subscriber = new Redis(url, { lazyConnect: true, maxRetriesPerRequest: null });
    for (const client of [this.publisher, this.subscriber]) {
      client.on('error', (error: Error) => {
        // Loud, and once per drop rather than once per retry: a chat layer that
        // stops delivering must not do it quietly (T-233 reports `healthy`).
        if (this.connected) this.log.error('chat bus lost redis', { detail: error.message });
        this.connected = false;
      });
      client.on('ready', () => {
        this.connected = true;
      });
    }
  }

  get healthy(): boolean {
    return this.connected;
  }

  async publish(broadcast: ChatBroadcast): Promise<void> {
    if (this.publisher.status === 'wait') await this.publisher.connect();
    await this.publisher.publish(CHAT_CHANNEL, JSON.stringify(broadcast));
  }

  async subscribe(listener: ChatBusListener): Promise<() => void> {
    this.listeners.add(listener);
    this.listening ??= this.listen();
    await this.listening;
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async listen(): Promise<void> {
    this.subscriber.on('message', (channel: string, payload: string) => {
      if (channel !== CHAT_CHANNEL) return;
      let parsed: unknown;
      try {
        parsed = JSON.parse(payload);
      } catch {
        // Something else is writing to our channel. Ignoring it is right;
        // crashing the instance over it is not.
        return;
      }
      const broadcast = parsed as ChatBroadcast;
      if (typeof broadcast?.conversation_id !== 'string' || broadcast.event === undefined) return;
      for (const listener of this.listeners) listener(broadcast);
    });
    if (this.subscriber.status === 'wait') await this.subscriber.connect();
    await this.subscriber.subscribe(CHAT_CHANNEL);
  }

  async close(): Promise<void> {
    this.listeners.clear();
    this.publisher.disconnect();
    this.subscriber.disconnect();
    await Promise.resolve();
  }
}

/**
 * What stands in when `REDIS_URL` is not set.
 *
 * It does not pretend. Publishing is a no-op that says so once, `healthy` is
 * false, and T-233's health endpoint reports it — because the failure this epic
 * has to avoid is a chat layer that looks fine and delivers nothing. The
 * conversation itself still works over HTTP (T-221); what is missing is the
 * transport, and the product can say which.
 */
export class AbsentChatBus implements ChatBus {
  private readonly log = new Logger('Chat');
  private warned = false;

  readonly healthy = false;

  async publish(): Promise<void> {
    if (!this.warned) {
      this.warned = true;
      this.log.error('REDIS_URL is not set; chat is not delivered live', {
        event: 'chat.bus_absent',
      });
    }
    await Promise.resolve();
  }

  async subscribe(): Promise<() => void> {
    return Promise.resolve(() => undefined);
  }

  async close(): Promise<void> {
    await Promise.resolve();
  }
}

export function chatBusFromEnv(env: NodeJS.ProcessEnv = process.env): ChatBus {
  const url = env.REDIS_URL;
  return url === undefined || url === '' ? new AbsentChatBus() : new RedisChatBus(url);
}
