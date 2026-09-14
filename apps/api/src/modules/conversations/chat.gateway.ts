import type { Duplex } from 'node:stream';
import type { IncomingMessage, Server } from 'node:http';
import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import {
  CHAT_CLOSE,
  CHAT_SOCKET_PATH,
  type ChatEvent,
  type ChatRefusal,
  type ChatServerFrame,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { WebSocket, WebSocketServer } from 'ws';
import { PG_POOL } from '../../database/database.module';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { ConversationsStore } from './internal/conversations-store';

/** Tunables the tests shorten; production takes the defaults. */
export const CHAT_GATEWAY_OPTIONS = Symbol('CHAT_GATEWAY_OPTIONS');

export interface ChatGatewayOptions {
  /**
   * Origins whose browsers may open a socket.
   *
   * A WebSocket handshake is not subject to CORS: any page on any site can open
   * one to us and the browser will attach the session cookie to it. The `Origin`
   * header is the only thing that distinguishes our own page from somebody
   * else's, which makes this list the whole defence against cross-site socket
   * hijacking — not a convenience setting.
   */
  allowedOrigins: string[];
  /** How often liveness and the session behind each socket are re-checked. */
  heartbeatMs: number;
  /** How many conversations one socket may hold at once. */
  maxSubscriptions: number;
}

export const DEFAULT_CHAT_GATEWAY_OPTIONS: Omit<ChatGatewayOptions, 'allowedOrigins'> = {
  heartbeatMs: 30_000,
  maxSubscriptions: 100,
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Connection {
  socket: WebSocket;
  userId: string;
  username: string;
  /**
   * The session token the handshake arrived with, so the socket can be
   * re-authenticated while it is open.
   *
   * Held in memory for the life of the connection, which is longer than a
   * request holds it. That is the cost of the alternative being worse: without
   * it, logging out closes no socket, and a connection opened before the
   * session ended keeps delivering messages to a browser that has no session
   * any more.
   */
  sessionToken: string;
  subscriptions: Set<string>;
  /** Cleared before each ping, set by the pong; a socket that misses one goes. */
  alive: boolean;
}

/**
 * The chat socket gateway (blueprint 8.3, T-230, D-010).
 *
 * **It delivers; it never decides.** Nothing a member can change happens here:
 * sending, removing, reacting, pinning, muting and leaving all stay on the HTTP
 * surface of T-221, where the database guards already refuse what must be
 * refused. A socket that could also write would be a second place to get those
 * guards right, and two places drift.
 *
 * **Authorisation happens twice: at subscribe, and again at delivery.** A socket
 * is long-lived and membership is not. Someone removed from a group mid-
 * conversation (T-241) must stop receiving it without waiting for a reconnect,
 * so every delivery re-asks the store rather than trusting the subscription —
 * which is the acceptance criterion of this task: *a socket can only ever carry
 * conversations its member participates in*.
 *
 * **Nothing publishes into it yet.** Fan-out is T-231 and goes through Redis
 * from its first commit: an in-process fan-out would work here, work in a
 * one-instance preview, and then silently deliver half the messages the day
 * there are two instances. So this task ships the leg a fan-out needs and stops
 * there, rather than shipping a version of the wrong thing.
 */
@Injectable()
export class ChatGateway implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger('Chat');
  private readonly server = new WebSocketServer({ noServer: true });
  private readonly connections = new Set<Connection>();
  private readonly store: ConversationsStore;
  private heartbeat: ReturnType<typeof setInterval> | null = null;
  private attachedTo: Server | null = null;
  private closing = false;

  constructor(
    @Inject(PG_POOL) pool: Pool,
    private readonly identity: IdentityService,
    private readonly adapters: HttpAdapterHost,
    @Inject(CHAT_GATEWAY_OPTIONS) private readonly options: ChatGatewayOptions,
  ) {
    this.store = new ConversationsStore(pool);
  }

  // -------------------------------------------------------------------------
  // What the rest of the API sees
  // -------------------------------------------------------------------------

  /** Open sockets. The health of the gateway in one number (T-233 reports it). */
  get connectionCount(): number {
    return this.connections.size;
  }

  /** How many subscriptions are held across every open socket. */
  get subscriptionCount(): number {
    let total = 0;
    for (const connection of this.connections) total += connection.subscriptions.size;
    return total;
  }

  /**
   * Send an event to every socket on this instance that is subscribed to the
   * conversation *and still a participant in it*, and return how many got it.
   *
   * The membership re-check is the point. A subscription is a claim made when it
   * was true; this asks whether it is true now, and ends the subscription with a
   * `dropped` frame when it is not.
   *
   * One lookup per subscribed socket, which for a direct conversation is at most
   * two. T-231, which will call this for every message, is where batching earns
   * its complexity — not here, where the cost is hypothetical.
   */
  async deliver(conversationId: string, event: ChatEvent): Promise<number> {
    const interested = [...this.connections].filter((connection) =>
      connection.subscriptions.has(conversationId),
    );
    let delivered = 0;
    for (const connection of interested) {
      const row = await this.store.participation(conversationId, connection.userId);
      // `participation` deliberately survives leaving, so that history stays
      // readable afterwards (T-223). Live delivery is the other question, and
      // this is where it has to be asked separately.
      if (row === null || row.left) {
        connection.subscriptions.delete(conversationId);
        this.send(connection, {
          type: 'dropped',
          conversation_id: conversationId,
          reason: 'not_a_participant',
        });
        continue;
      }
      this.send(connection, { type: 'event', conversation_id: conversationId, event });
      delivered += 1;
    }
    return delivered;
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  onApplicationBootstrap(): void {
    const instance = this.adapters.httpAdapter?.getInstance<{ server?: Server }>();
    const http = instance?.server;
    if (http === undefined) {
      // A testing module with no HTTP server. There is nothing to upgrade.
      return;
    }
    http.on('upgrade', this.upgrade);
    this.attachedTo = http;
    this.heartbeat = setInterval(() => {
      void this.sweep();
    }, this.options.heartbeatMs);
  }

  async onModuleDestroy(): Promise<void> {
    this.closing = true;
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    this.heartbeat = null;
    this.attachedTo?.off('upgrade', this.upgrade);
    this.attachedTo = null;
    for (const connection of [...this.connections]) {
      connection.socket.close(CHAT_CLOSE.GOING_AWAY, 'server shutting down');
    }
    this.connections.clear();
    await new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  // -------------------------------------------------------------------------
  // The handshake
  // -------------------------------------------------------------------------

  private readonly upgrade = (request: IncomingMessage, socket: Duplex, head: Buffer): void => {
    // This gateway is the only upgrade listener on the server, so an upgrade it
    // does not answer would hang until the socket timed out. Say no instead.
    const path = (request.url ?? '').split('?')[0];
    if (path !== CHAT_SOCKET_PATH) {
      refuse(socket, 404, 'Not Found');
      return;
    }
    void this.accept(request, socket, head).catch((error: unknown) => {
      this.log.error('chat socket handshake failed', {
        detail: error instanceof Error ? error.message : String(error),
      });
      refuse(socket, 500, 'Internal Server Error');
    });
  };

  private async accept(request: IncomingMessage, socket: Duplex, head: Buffer): Promise<void> {
    if (this.closing) {
      refuse(socket, 503, 'Service Unavailable');
      return;
    }

    // A browser always sends `Origin`; a handshake without one cannot be a page
    // acting with somebody else's ambient cookie, which is the attack this
    // check exists for. Present and wrong is refused; absent is allowed, and a
    // client in that position had to obtain the session token by other means.
    const origin = request.headers.origin;
    if (typeof origin === 'string' && !this.options.allowedOrigins.includes(origin)) {
      this.log.warn('chat socket refused: origin', { origin });
      refuse(socket, 403, 'Forbidden');
      return;
    }

    const token = parseCookies(request.headers.cookie)[SESSION_COOKIE];
    const user = await this.identity.authenticate(token);
    if (user === null || token === undefined) {
      // Refused as HTTP rather than accepted and closed: a connection that was
      // never authenticated should not become a WebSocket in the first place.
      refuse(socket, 401, 'Unauthorized');
      return;
    }

    this.server.handleUpgrade(request, socket, head, (ws) => {
      this.open(ws, { id: user.id, username: user.username }, token);
    });
  }

  private open(socket: WebSocket, user: { id: string; username: string }, token: string): void {
    const connection: Connection = {
      socket,
      userId: user.id,
      username: user.username,
      sessionToken: token,
      subscriptions: new Set(),
      alive: true,
    };
    this.connections.add(connection);

    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('message', (data: unknown, isBinary: boolean) => {
      if (isBinary) {
        this.close(connection, CHAT_CLOSE.BAD_PROTOCOL, 'this protocol is text');
        return;
      }
      void this.handle(connection, String(data)).catch((error: unknown) => {
        this.log.error('chat socket frame failed', {
          detail: error instanceof Error ? error.message : String(error),
        });
        this.send(connection, { type: 'error', message: 'That could not be handled.' });
      });
    });
    const forget = (): void => {
      this.connections.delete(connection);
    };
    socket.on('close', forget);
    socket.on('error', forget);

    this.send(connection, {
      type: 'ready',
      username: user.username,
      at: new Date().toISOString(),
    });
  }

  // -------------------------------------------------------------------------
  // Frames
  // -------------------------------------------------------------------------

  private async handle(connection: Connection, raw: string): Promise<void> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this.send(connection, { type: 'error', message: 'That is not a frame.' });
      return;
    }
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      this.send(connection, { type: 'error', message: 'That is not a frame.' });
      return;
    }

    const frame = parsed as { type?: unknown; conversation_id?: unknown };
    const conversationId =
      typeof frame.conversation_id === 'string' ? frame.conversation_id.toLowerCase() : '';

    if (frame.type === 'unsubscribe') {
      connection.subscriptions.delete(conversationId);
      this.send(connection, { type: 'unsubscribed', conversation_id: conversationId });
      return;
    }
    if (frame.type !== 'subscribe') {
      this.send(connection, { type: 'error', message: 'Unknown frame type.' });
      return;
    }

    const refused = (reason: ChatRefusal): void => {
      this.send(connection, { type: 'refused', conversation_id: conversationId, reason });
    };
    if (!UUID.test(conversationId)) {
      refused('invalid');
      return;
    }
    if (
      connection.subscriptions.size >= this.options.maxSubscriptions &&
      !connection.subscriptions.has(conversationId)
    ) {
      refused('invalid');
      return;
    }

    const row = await this.store.participation(conversationId, connection.userId);
    if (row === null) {
      // Not "you are not in it": telling somebody a conversation exists is
      // already telling them something about the people in it.
      refused('not_found');
      return;
    }
    if (row.left) {
      // They can still read it (T-223); there is just nothing live to follow.
      refused('not_a_participant');
      return;
    }

    connection.subscriptions.add(conversationId);
    this.send(connection, {
      type: 'subscribed',
      conversation_id: conversationId,
      latest_seq: Number(row.latest_seq),
    });
  }

  private send(connection: Connection, frame: ChatServerFrame): void {
    if (connection.socket.readyState !== WebSocket.OPEN) return;
    connection.socket.send(JSON.stringify(frame));
  }

  private close(connection: Connection, code: number, reason: string): void {
    this.connections.delete(connection);
    connection.socket.close(code, reason);
  }

  /**
   * Every heartbeat: hang up on sockets that stopped answering, and on sockets
   * whose session has since ended. The second is why this does database work at
   * all — a member who logs out should not keep a delivery channel open.
   */
  private async sweep(): Promise<void> {
    for (const connection of [...this.connections]) {
      if (!connection.alive) {
        this.connections.delete(connection);
        connection.socket.terminate();
        continue;
      }
      connection.alive = false;
      connection.socket.ping();

      const user = await this.identity.authenticate(connection.sessionToken);
      if (user === null) {
        this.close(connection, CHAT_CLOSE.UNAUTHENTICATED, 'session ended');
      }
    }
  }
}

/** Answer an upgrade with a plain HTTP response and hang up. */
function refuse(socket: Duplex, status: number, message: string): void {
  socket.write(`HTTP/1.1 ${status} ${message}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}
