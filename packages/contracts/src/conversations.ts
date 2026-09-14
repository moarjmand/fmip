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

/**
 * What a message can carry besides words (blueprint 8.3, T-222).
 *
 * `article` joins the list when E14 builds news. Nothing here is stored on the
 * message: the message holds a kind and a UUID, and the card below is resolved
 * when the conversation is read.
 */
export const CARD_KINDS = ['fixture', 'team', 'person', 'prediction'] as const;
export type CardKind = (typeof CARD_KINDS)[number];

/**
 * A shared card, resolved now rather than copied when it was sent.
 *
 * Blueprint 8.3: "Match cards shared in chat remain live. The score and status
 * update without replacing the original discussion context." So a fixture card
 * carries the score it has *now* and its own `last_updated_at` (rule 4) — a
 * number copied at send time would be a stale score displayed as a current one,
 * permanently, in a place nobody would think to go and fix.
 *
 * `gone` is the honest answer when the entity no longer resolves: the message
 * still says somebody shared something, and the product does not invent what.
 */
export type SharedCard =
  | {
      kind: 'fixture';
      id: string;
      home: string;
      away: string;
      score: { home: number; away: number } | null;
      status: string;
      kickoff_at: string;
      /** ISO 8601 (rule 4). */
      last_updated_at: string;
    }
  | { kind: 'team'; id: string; name: string; short_name: string | null }
  | { kind: 'person'; id: string; name: string }
  | {
      kind: 'prediction';
      id: string;
      fixture_id: string;
      home: string;
      away: string;
      outcome: string;
      confidence: number;
      /** The member who made it. A shared prediction is always attributed. */
      by: string;
    }
  | { kind: 'gone'; shared: CardKind };

/**
 * The reactions a message can carry (blueprint 8.3, T-225).
 *
 * A closed set rather than an open emoji field. An arbitrary string attached to
 * somebody else's words is a small free-text box, and a small free-text box is
 * where abuse goes once the big one is moderated. Six covers what a football
 * conversation actually does: agree, disagree, laugh, be surprised, commiserate,
 * celebrate.
 */
export const REACTIONS = ['agree', 'disagree', 'laugh', 'surprise', 'sad', 'celebrate'] as const;
export type Reaction = (typeof REACTIONS)[number];

/** How many members reacted this way, and whether the viewer is one of them. */
export interface ReactionCount {
  reaction: Reaction;
  count: number;
  mine: boolean;
}

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
  /** `null` when the message is only words, and always null once removed. */
  card: SharedCard | null;
  /** Empty once removed: a tombstone leaves no applauded outline. */
  reactions: ReactionCount[];
  /**
   * The usernames this message named, resolved when it was written.
   *
   * Stored rather than parsed at read time, because who was mentioned is a fact
   * about the moment: resolving `@name` again later would change who a
   * two-year-old message mentioned every time somebody renamed themselves.
   */
  mentions: string[];
  pinned: boolean;
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
  /**
   * Pinned messages, newest pin first — and always present, whether or not they
   * fall inside the page being read. A pin nobody can find once the
   * conversation has scrolled past it is not a pin.
   */
  pinned: Message[];
}

/** The shortest term worth running: one letter matches most of a conversation. */
export const MIN_SEARCH_TERM = 2;
export const SEARCH_RESULT_LIMIT = 50;

/**
 * `GET /me/conversations/:id/search?q=` (blueprint 8.3, T-223).
 *
 * Newest first, because somebody searching a conversation is usually looking for
 * the last time something was said rather than the first. Each hit carries its
 * `seq`, so opening it is `?before=<seq + 1>` on the page endpoint — the same
 * sequence the whole surface is built on.
 */
export interface ConversationSearchResponse {
  /** The term as it was run, after trimming. */
  term: string;
  messages: Message[];
  /** True when more matched than `SEARCH_RESULT_LIMIT` returned. */
  more: boolean;
}

export interface SendMessageRequest {
  /** Optional when a card is shared: a match with no comment is a real thing to send. */
  body?: string;
  reply_to_id?: string | null;
  /** The entity to share, by kind and internal UUID (rule 1). */
  card?: { kind: CardKind; id: string } | null;
}

/** What `POST` answers with, so a sender knows where their message landed. */
export interface SendMessageResponse {
  message: Message;
}
