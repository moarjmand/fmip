/**
 * The chat socket protocol (blueprint 8.3, T-230, D-010).
 *
 * A socket carries *delivery*, never authority. Everything a member can change
 * — sending, removing, reacting, pinning, muting, leaving — stays on the HTTP
 * surface of T-221, where each write already passes the guards the database
 * enforces. A second write path over a socket would be a second place to get
 * those guards right, and the second place is the one that is wrong.
 *
 * So the client says only which conversations it wants to hear about, and the
 * server says what happened in them. Both directions are newline-free JSON, one
 * frame per message.
 */

import type { Message } from './conversations';

/** The path the gateway answers on, under the same prefix as the HTTP surface. */
export const CHAT_SOCKET_PATH = '/me/conversations/socket';

/**
 * Close codes in the private range (4000-4999), so they can never be confused
 * with a protocol-level close.
 *
 * `UNAUTHENTICATED` is sent as an HTTP 401 *instead of* completing the
 * handshake — a connection that was never authenticated should not become a
 * WebSocket at all — and is listed here because the reconnecting client treats
 * both the same way: stop, do not retry, the session is gone.
 */
export const CHAT_CLOSE = {
  /** No session, or a session that has since been revoked. */
  UNAUTHENTICATED: 4401,
  /** The handshake came from an origin this deployment does not serve. */
  FORBIDDEN_ORIGIN: 4403,
  /** Frames that are not this protocol; the connection is not worth keeping. */
  BAD_PROTOCOL: 4400,
  /** The server is shutting down. The client should reconnect. */
  GOING_AWAY: 4503,
} as const;

export type ChatCloseCode = (typeof CHAT_CLOSE)[keyof typeof CHAT_CLOSE];

/** What the client asks for. */
export type ChatClientFrame =
  { type: 'subscribe'; conversation_id: string } | { type: 'unsubscribe'; conversation_id: string };

/**
 * Why a subscription was refused.
 *
 * `not_found` covers both "there is no such conversation" and "you were never
 * in it", for the same reason the HTTP surface does: telling a stranger that a
 * conversation exists is already telling them something about the people in it.
 *
 * `not_a_participant` is the different case of somebody who *was* in it and has
 * left. They can still read the history over HTTP (T-223), so answering them
 * "no such conversation" would be a lie they could disprove; what is true is
 * that there is nothing live here for them any more.
 */
export type ChatRefusal = 'not_found' | 'invalid' | 'not_a_participant';

/**
 * Why a subscription the server had accepted has ended.
 *
 * The same word the refusal uses, and only one of them: whether the member left
 * or a group owner removed them (T-241) is not a distinction a participation
 * lookup can make, and "you left" said to somebody who was removed would be a
 * small lie told by the transport. The frame describes the subscription ending,
 * not anybody's intent.
 */
export type ChatDropReason = 'not_a_participant';

export type ChatServerFrame =
  /** First frame on every connection: who the server thinks you are. */
  | { type: 'ready'; username: string; at: string }
  | {
      type: 'subscribed';
      conversation_id: string;
      /**
       * The sequence of the newest message at the moment of subscribing.
       *
       * A client that has read up to N and is told the conversation is at M > N
       * knows it has a gap before a single live frame arrives — which is what
       * T-231 recovers from, and why this is here rather than in that task.
       */
      latest_seq: number;
    }
  | { type: 'unsubscribed'; conversation_id: string }
  /**
   * A subscription the server is ending on its own: membership is not
   * permanent, and a socket opened while you were in a conversation must stop
   * carrying it the moment you are not.
   */
  | { type: 'dropped'; conversation_id: string; reason: ChatDropReason }
  | { type: 'refused'; conversation_id: string; reason: ChatRefusal }
  /**
   * Something happened in a subscribed conversation.
   *
   * A tagged union rather than a message, because T-232 delivers a card whose
   * score moved without a new message being sent. The seam is declared here and
   * the branch is added by the task that needs it.
   */
  | { type: 'event'; conversation_id: string; event: ChatEvent }
  | { type: 'error'; message: string };

/**
 * What can happen in a conversation. Each member names the task that delivers
 * it; the union is what lets a later one be added without reshaping the frame.
 *
 * The message is the same `Message` the HTTP surface returns, and deliberately
 * so: a socket that shipped a leaner shape would become a second contract for
 * the same thing, and the page would have to render two of them.
 */
export type ChatEvent = { kind: 'message'; message: Message };
