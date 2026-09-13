/**
 * Conversations (blueprint 8.3, T-220).
 *
 * **Order is a sequence, not a time.** Every message carries `seq`, unique and
 * increasing within its conversation, and every question a client asks about
 * order is asked in those terms. `created_at` is for showing a reader when
 * something was said; it is never what decides what came first, because two
 * messages in the same millisecond tie and a clock that steps backwards
 * reorders a conversation retroactively.
 *
 * **A message is never edited.** Blueprint 8.3 lists replies, reactions,
 * mentions and pins, and does not list editing — so there is no edit request
 * here and no version list on a message. What exists instead is removal, which
 * leaves a tombstone rather than a hole.
 */

/** `group` joins this list with the groups of T-240. */
export const CONVERSATION_KINDS = ['direct'] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

export const MAX_MESSAGE_LENGTH = 4_000;
export const MESSAGE_PAGE_SIZE = 50;

export interface ConversationMember {
  username: string;
  display_name: string;
}

/**
 * Who took a message down.
 *
 * A reader can tell "the author thought better of it" from "a moderator took it
 * down", and only one of those is a moderation record. Both leave the row, so
 * the conversation around it still reads.
 */
export type MessageRemoval = 'author' | 'moderator';

export interface Message {
  id: string;
  /** Unique and increasing within the conversation. What ordering means here. */
  seq: number;
  /** The author's username. */
  author: string;
  /** `null` once removed: the tombstone below says by whom. */
  body: string | null;
  reply_to_id: string | null;
  /** ISO 8601. For display, never for ordering. */
  created_at: string;
  removed: { at: string; by: MessageRemoval } | null;
}

export interface ConversationSummary {
  id: string;
  kind: ConversationKind;
  /** Everyone in it, the viewer included. */
  members: ConversationMember[];
  last_message: Message | null;
  /** Messages after the viewer's own read position. */
  unread: number;
  muted: boolean;
  /** Whether the viewer has left: they can still read it and not write to it. */
  left: boolean;
  /**
   * How far the *other* member has read, in a direct conversation only.
   *
   * `null` in every other kind, deliberately. In a two-hundred-person group a
   * read receipt is a surveillance feature nobody reads and everybody is
   * subject to; between two people it is information.
   */
  their_read_seq: number | null;
}

export interface ConversationsResponse {
  conversations: ConversationSummary[];
}

/**
 * One conversation and a page of it, oldest first.
 *
 * `latest_seq` is what a client asks "after" for the next thing — on a
 * reconnect, on a poll, or over a socket (T-231). It is the whole reason the
 * ordering is a sequence: "everything after 41" is a question with one answer.
 */
export interface ConversationPage {
  conversation: ConversationSummary;
  messages: Message[];
  latest_seq: number;
  /** Whether anything stands before `messages[0]`. */
  has_earlier: boolean;
}

export interface SendMessageRequest {
  body: string;
  reply_to_id?: string | null;
}

/** What `POST` answers with, so a sender knows where their message landed. */
export interface SendMessageResponse {
  message: Message;
}
