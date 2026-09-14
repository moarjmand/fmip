import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Pool } from 'pg';
import {
  CARD_KINDS,
  type CardKind,
  type ChatEvent,
  type ConversationKind,
  type ConversationPage,
  type ConversationSummary,
  MAX_MESSAGE_LENGTH,
  MESSAGE_PAGE_SIZE,
  MIN_SEARCH_TERM,
  REACTIONS,
  SEARCH_RESULT_LIMIT,
  type ConversationSearchResponse,
  type Message,
  type MessageRemoval,
  type Reaction,
  type ReactionCount,
  type SendMessageRequest,
  type SharedCard,
} from '@fmip/contracts';
import { PG_POOL } from '../../database/database.module';
import { ModerationService } from '../moderation/moderation.service';
import { CHAT_BUS, type ChatBus } from './internal/chat-bus';
import {
  CardStore,
  type ConversationRow,
  ConversationsStore,
  type MentionRow,
  type MessageRow,
  type ReactionRow,
} from './internal/conversations-store';

/** SQLSTATEs the T-220 triggers raise. */
const BLOCKED = 'PL003';
const SANCTIONED = 'PL004';
const NOT_A_PARTICIPANT = 'PL006';
const OVER_RATE = 'PL005';
/** Raised when something is attempted on a message that has been removed. */
const ALREADY_REMOVED = 'PL007';

export type ConversationOutcome<T> =
  | { ok: true; value: T }
  | {
      ok: false;
      reason:
        | 'unknown_member'
        | 'self'
        | 'not_friends'
        | 'unavailable'
        | 'email_unverified'
        | 'restricted'
        | 'rate_limited'
        | 'not_found'
        | 'left'
        | 'removed'
        | 'invalid';
      fields?: Record<string, string>;
    };

type CardLookup = Map<string, SharedCard>;

/** How many messages one card change may refresh at once (T-232). */
const CARD_PUSH_LIMIT = 50;

/** Reactions, mentions and pins for a page, keyed by message (T-225). */
interface Marks {
  reactions: Map<string, ReactionCount[]>;
  mentions: Map<string, string[]>;
  pinned: Set<string>;
}

const NO_MARKS: Marks = { reactions: new Map(), mentions: new Map(), pinned: new Set() };

function message(row: MessageRow, cards: CardLookup = new Map(), marks: Marks = NO_MARKS): Message {
  return {
    id: row.id,
    seq: Number(row.seq),
    author: row.author,
    body: row.body,
    reply_to_id: row.reply_to_id,
    created_at: row.created_at.toISOString(),
    removed:
      row.removed_at === null
        ? null
        : {
            at: row.removed_at.toISOString(),
            by: (row.removed_kind ?? 'author') as MessageRemoval,
          },
    card:
      row.card_kind === null || row.card_id === null
        ? null
        : // An entity that no longer resolves is `gone` rather than absent: the
          // message still says somebody shared something, and the product does
          // not invent what.
          (cards.get(`${row.card_kind}:${row.card_id}`) ?? {
            kind: 'gone',
            shared: row.card_kind as CardKind,
          }),
    // A tombstone leaves no applauded outline: the database drops both when a
    // message is removed (T-225), and these are empty rather than stale.
    reactions: marks.reactions.get(row.id) ?? [],
    mentions: marks.mentions.get(row.id) ?? [],
    pinned: marks.pinned.has(row.id),
  };
}

function collectMarks(
  reactions: ReactionRow[],
  mentions: MentionRow[],
  pinned: Set<string>,
): Marks {
  const byMessage = new Map<string, ReactionCount[]>();
  for (const row of reactions) {
    byMessage.set(row.message_id, [
      ...(byMessage.get(row.message_id) ?? []),
      { reaction: row.reaction as Reaction, count: Number(row.count), mine: row.mine },
    ]);
  }
  const named = new Map<string, string[]>();
  for (const row of mentions) {
    named.set(row.message_id, [...(named.get(row.message_id) ?? []), row.username]);
  }
  return { reactions: byMessage, mentions: named, pinned };
}

/**
 * The conversations boundary (blueprint 8.3, T-221).
 *
 * **Opening a direct conversation needs a friendship; sending into one does
 * not.** Blueprint 8.1 lists "start a direct conversation" among the things
 * friends can do, and taking that literally removes the whole direct-message
 * spam surface: there is no way to put words in front of somebody who has not
 * agreed to hear from you.
 *
 * But an *existing* conversation stays writable after a friendship ends, and
 * that is deliberate. Removing a friend and blocking somebody are different
 * acts — the friends page says so — and making the first silently stop messages
 * would collapse them into one while leaving a conversation that looks open and
 * is not. A member who wants the messages to stop blocks, and the database
 * refuses the next one.
 *
 * **Every other refusal belongs to the database** (T-220): participation, the
 * block, the sanction and the ceiling. This service turns their SQLSTATEs into
 * sentences and never checks first.
 */
@Injectable()
export class ConversationsService {
  private readonly log = new Logger('Chat');
  private readonly store: ConversationsStore;
  private readonly cards: CardStore;

  constructor(
    @Inject(PG_POOL) pool: Pool,
    private readonly moderation: ModerationService,
    @Inject(CHAT_BUS) private readonly bus: ChatBus,
  ) {
    this.store = new ConversationsStore(pool);
    this.cards = new CardStore(pool);
  }

  /**
   * Resolve every card in a set of messages, now (T-222).
   *
   * One query per kind rather than one per card, and always at read time: a
   * score copied into a message when it was sent would be a stale number shown
   * as a current one, permanently, in a place nobody would think to go and fix
   * (rules 1 and 4).
   */
  private async resolveCards(
    rows: Pick<MessageRow, 'card_kind' | 'card_id'>[],
  ): Promise<CardLookup> {
    const wanted = new Map<string, string[]>();
    for (const row of rows) {
      if (row.card_kind === null || row.card_id === null) continue;
      wanted.set(row.card_kind, [...(wanted.get(row.card_kind) ?? []), row.card_id]);
    }
    if (wanted.size === 0) return new Map();

    const [fixtures, teams, people, predictions] = await Promise.all([
      this.cards.fixtures(wanted.get('fixture') ?? []),
      this.cards.teams(wanted.get('team') ?? []),
      this.cards.people(wanted.get('person') ?? []),
      this.cards.predictions(wanted.get('prediction') ?? []),
    ]);

    const lookup: CardLookup = new Map();
    for (const [id, row] of fixtures) {
      lookup.set(`fixture:${id}`, {
        kind: 'fixture',
        id,
        home: row.home,
        away: row.away,
        score:
          row.home_goals === null || row.away_goals === null
            ? null
            : { home: row.home_goals, away: row.away_goals },
        status: row.status,
        kickoff_at: row.kickoff_at.toISOString(),
        last_updated_at: row.last_updated_at.toISOString(),
      });
    }
    for (const [id, row] of teams) {
      lookup.set(`team:${id}`, {
        kind: 'team',
        id,
        name: row.name,
        short_name: row.short_name,
      });
    }
    for (const [id, row] of people) {
      lookup.set(`person:${id}`, { kind: 'person', id, name: row.name });
    }
    for (const [id, row] of predictions) {
      lookup.set(`prediction:${id}`, {
        kind: 'prediction',
        id,
        fixture_id: row.fixture_id,
        home: row.home,
        away: row.away,
        outcome: row.outcome,
        confidence: row.confidence,
        by: row.by,
      });
    }
    return lookup;
  }

  /** The reactions, mentions and pins on a set of messages, in three queries. */
  private async marksFor(rows: MessageRow[], viewerId: string): Promise<Marks> {
    const ids = rows.map((row) => row.id);
    if (ids.length === 0) return NO_MARKS;
    const { reactions, mentions, pinned } = await this.store.marks(ids, viewerId);
    return collectMarks(reactions, mentions, pinned);
  }

  async list(viewerId: string): Promise<ConversationSummary[]> {
    const rows = await this.store.conversationsFor(viewerId);
    const ids = rows.map((row) => row.id);
    const [participants, latest] = await Promise.all([
      this.store.participantsOf(ids),
      this.store.latest(ids),
    ]);

    const members = new Map<string, ConversationSummary['members']>();
    for (const row of participants) {
      const list = members.get(row.conversation_id) ?? [];
      list.push({ username: row.username, display_name: row.display_name });
      members.set(row.conversation_id, list);
    }

    const newest = [...latest.values()];
    const [cards, marks] = await Promise.all([
      this.resolveCards(newest),
      this.marksFor(newest, viewerId),
    ]);
    return rows.map((row) =>
      summary(row, members.get(row.id) ?? [], latest.get(row.id) ?? null, cards, marks),
    );
  }

  /**
   * Open the direct conversation with a member, or find the one that is already
   * there. Idempotent: "message them" twice is one conversation.
   */
  async openDirect(
    viewer: { id: string; emailVerified: boolean },
    username: string,
  ): Promise<ConversationOutcome<string>> {
    const other = await this.store.memberByUsername(username);
    if (other === null) return { ok: false, reason: 'unknown_member' };
    if (other.id === viewer.id) return { ok: false, reason: 'self' };
    if (!viewer.emailVerified) return { ok: false, reason: 'email_unverified' };
    if (!(await this.store.areFriends(viewer.id, other.id))) {
      return { ok: false, reason: 'not_friends' };
    }

    try {
      const { id } = await this.store.openDirect(viewer.id, other.id);
      return { ok: true, value: id };
    } catch (error) {
      return this.refusal(error);
    }
  }

  async page(
    viewerId: string,
    conversationId: string,
    before: number | null,
  ): Promise<ConversationPage | null> {
    const row = await this.store.participation(conversationId, viewerId);
    if (row === null) return null;

    const [{ messages, hasEarlier }, participants, latest] = await Promise.all([
      this.store.page(conversationId, before, MESSAGE_PAGE_SIZE),
      this.store.participantsOf([conversationId]),
      this.store.latest([conversationId]),
    ]);
    const pins = await this.store.pins(conversationId);
    const everything = [...messages, ...latest.values(), ...pins];
    const [cards, marks] = await Promise.all([
      this.resolveCards(everything),
      this.marksFor(everything, viewerId),
    ]);

    return {
      conversation: summary(
        row,
        participants.map((p) => ({ username: p.username, display_name: p.display_name })),
        latest.get(conversationId) ?? null,
        cards,
        marks,
      ),
      messages: messages.map((m) => message(m, cards, marks)),
      latest_seq: Number(row.latest_seq),
      has_earlier: hasEarlier,
      // Always sent, whether or not they fall inside the page being read: a pin
      // nobody can find once the conversation has scrolled past it is not a pin.
      pinned: pins.map((m) => message(m, cards, marks)),
    };
  }

  /**
   * The card these conversations share, resolved now, for every message it
   * still hangs on (T-232).
   *
   * Resolved rather than remembered, which is the same rule `message()` follows:
   * a score copied at send time would be a stale number shown as a current one
   * (rules 1 and 4). The caller supplies the conversations, because the only
   * ones worth asking about are those a socket is watching.
   *
   * Capped. A conversation that shared one fixture fifty times is not a case to
   * serve fifty frames for, and the cards that miss an update still carry their
   * own `last_updated_at`, which is what a reader judges freshness by.
   */
  async sharedCardUpdates(
    conversationIds: string[],
    kind: CardKind,
    cardId: string,
  ): Promise<{ conversation_id: string; message_id: string; card: SharedCard }[]> {
    const rows = await this.store.messagesSharing(conversationIds, kind, cardId, CARD_PUSH_LIMIT);
    if (rows.length === 0) return [];

    const cards = await this.resolveCards([{ card_kind: kind, card_id: cardId }]);
    const card = cards.get(`${kind}:${cardId}`);
    // The entity stopped resolving between the change and this query. Saying
    // nothing is right: the card a reader already has is what it was, and a
    // `gone` card pushed at them would be this surface inventing a story.
    if (card === undefined) return [];

    return rows.map((row) => ({
      conversation_id: row.conversation_id,
      message_id: row.id,
      card,
    }));
  }

  /**
   * Everything after a sequence, for a client that has been away (T-235).
   *
   * `null` when the viewer is not a participant, and **also** when they have
   * left: leaving does not lose the history (they can still read it and search
   * it), but it does end any claim on what is said next. That is the same
   * question the socket asks at delivery, asked here too rather than trusted
   * from the caller.
   *
   * Bounded at one page. A client whose gap is longer than that has been away
   * long enough that reading the conversation is the right answer, and `more`
   * says so instead of replaying an unbounded history down a socket.
   */
  async since(
    viewerId: string,
    conversationId: string,
    afterSeq: number,
  ): Promise<{ messages: Message[]; more: boolean } | null> {
    const row = await this.store.participation(conversationId, viewerId);
    if (row === null || row.left) return null;

    const { messages, more } = await this.store.after(conversationId, afterSeq, MESSAGE_PAGE_SIZE);
    if (messages.length === 0) return { messages: [], more };
    const [cards, marks] = await Promise.all([
      this.resolveCards(messages),
      this.marksFor(messages, viewerId),
    ]);
    return { messages: messages.map((m) => message(m, cards, marks)), more };
  }

  /**
   * Search inside one conversation.
   *
   * Only a conversation the viewer is in, and it works after they have left —
   * leaving is not losing what was said. A term shorter than two characters is
   * refused rather than run: one letter matches most of a conversation, which is
   * a result nobody wanted and a scan nobody needed.
   */
  async search(
    viewerId: string,
    conversationId: string,
    rawTerm: string,
  ): Promise<ConversationSearchResponse | null> {
    const term = rawTerm.trim();
    const row = await this.store.participation(conversationId, viewerId);
    if (row === null) return null;
    if (term.length < MIN_SEARCH_TERM) return { term, messages: [], more: false };

    const { messages, more } = await this.store.search(conversationId, term, SEARCH_RESULT_LIMIT);
    const [cards, marks] = await Promise.all([
      this.resolveCards(messages),
      this.marksFor(messages, viewerId),
    ]);
    return { term, messages: messages.map((m) => message(m, cards, marks)), more };
  }

  async send(
    viewerId: string,
    conversationId: string,
    body: SendMessageRequest,
  ): Promise<ConversationOutcome<Message>> {
    const text = typeof body?.body === 'string' ? body.body.trim() : '';
    const card = body?.card ?? null;
    if (text === '' && card === null) {
      // A card with no comment is a real thing to send; nothing at all is not.
      return { ok: false, reason: 'invalid', fields: { body: 'A message needs something in it.' } };
    }
    if (text.length > MAX_MESSAGE_LENGTH) {
      return {
        ok: false,
        reason: 'invalid',
        fields: { body: `At most ${MAX_MESSAGE_LENGTH} characters.` },
      };
    }

    const row = await this.store.participation(conversationId, viewerId);
    if (row === null) return { ok: false, reason: 'not_found' };
    if (row.left) return { ok: false, reason: 'left' };

    const replyTo = typeof body.reply_to_id === 'string' ? body.reply_to_id : null;
    if (replyTo !== null && !(await this.store.replyBelongs(conversationId, replyTo))) {
      // A reply pointing at another conversation is a link to nowhere, and
      // worse, a way to learn that a message id exists somewhere else.
      return {
        ok: false,
        reason: 'invalid',
        fields: { reply_to_id: 'No such message in this conversation.' },
      };
    }

    if (card !== null) {
      if (!(CARD_KINDS as readonly string[]).includes(card.kind)) {
        return {
          ok: false,
          reason: 'invalid',
          fields: { card: `Must be one of ${CARD_KINDS.join(', ')}.` },
        };
      }
      // The entity is checked to exist on write, because `card_id` names one of
      // four tables by `card_kind` and no foreign key can do it (the same shape
      // as `provider_mapping` in T-013 and `report.subject_id`).
      if (typeof card.id !== 'string' || !(await this.cards.exists(card.kind, card.id))) {
        return { ok: false, reason: 'invalid', fields: { card: 'No such thing to share.' } };
      }
      // A member shares their own prediction and nobody else's: somebody's
      // prediction history may be private (T-056), and this must not be the way
      // around it.
      if (card.kind === 'prediction' && !(await this.cards.ownsPrediction(viewerId, card.id))) {
        return {
          ok: false,
          reason: 'invalid',
          fields: { card: 'You can share your own prediction.' },
        };
      }
    }

    try {
      const written = await this.store.send(
        conversationId,
        viewerId,
        text === '' ? null : text,
        replyTo,
        card?.kind ?? null,
        card?.id ?? null,
      );
      await this.recordMentions(conversationId, written.id, text);
      const [cards, marks] = await Promise.all([
        this.resolveCards([written]),
        this.marksFor([written], viewerId),
      ]);
      const sent = message(written, cards, marks);
      await this.announce(conversationId, { kind: 'message', message: sent });
      return { ok: true, value: sent };
    } catch (error) {
      return this.refusal(error);
    }
  }

  /**
   * Tell the other instances (T-231).
   *
   * The message is already stored and already answered for; a bus that is down
   * must not turn a successful send into a failed one. So this logs and returns:
   * what a client loses is immediacy, and it recovers by asking for everything
   * after the last sequence it holds (T-235).
   */
  private async announce(conversationId: string, event: ChatEvent): Promise<void> {
    try {
      await this.bus.publish({ conversation_id: conversationId, event });
    } catch (error) {
      this.log.error('chat broadcast failed', {
        event: 'chat.broadcast_failed',
        conversation: conversationId,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Resolve `@name` once, against the people already in the conversation.
   *
   * **Only participants.** Mentioning somebody who is not in the room would be
   * a way to put a notification in front of a stranger, which is the direct-
   * message spam surface arriving through a side door.
   *
   * A mention that the database refuses (PL003, a block) is dropped rather than
   * failing the message: the words were already said and are already stored, and
   * taking the whole message down because one name in it could not be delivered
   * would be a worse answer than delivering the rest.
   */
  private async recordMentions(
    conversationId: string,
    messageId: string,
    body: string,
  ): Promise<void> {
    const named = [...body.matchAll(/@([a-z0-9_]{3,20})/gi)].map((match) =>
      (match[1] ?? '').toLowerCase(),
    );
    if (named.length === 0) return;

    const members = await this.store.participantIdsByUsername(conversationId);
    const ids = [...new Set(named)]
      .map((username) => members.get(username))
      .filter((id): id is string => id !== undefined);

    for (const id of ids) {
      try {
        await this.store.mention(messageId, [id]);
      } catch (error) {
        if ((error as { code?: string }).code !== BLOCKED) throw error;
      }
    }
  }

  /** Add a reaction. Idempotent: reacting twice is reacting once. */
  async react(
    viewerId: string,
    conversationId: string,
    messageId: string,
    reaction: string,
  ): Promise<ConversationOutcome<true>> {
    if (!(REACTIONS as readonly string[]).includes(reaction)) {
      return {
        ok: false,
        reason: 'invalid',
        fields: { reaction: `Must be one of ${REACTIONS.join(', ')}.` },
      };
    }
    const found = await this.owned(viewerId, conversationId, messageId);
    if (found !== null) return found;

    try {
      await this.store.react(messageId, viewerId, reaction);
      return { ok: true, value: true };
    } catch (error) {
      return this.refusal(error);
    }
  }

  async unreact(
    viewerId: string,
    conversationId: string,
    messageId: string,
    reaction: string,
  ): Promise<ConversationOutcome<true>> {
    const found = await this.owned(viewerId, conversationId, messageId);
    if (found !== null) return found;
    await this.store.unreact(messageId, viewerId, reaction);
    return { ok: true, value: true };
  }

  async setPinned(
    viewerId: string,
    conversationId: string,
    messageId: string,
    pinned: boolean,
  ): Promise<ConversationOutcome<true>> {
    const found = await this.owned(viewerId, conversationId, messageId);
    if (found !== null) return found;

    try {
      if (pinned) await this.store.pin(conversationId, messageId, viewerId);
      else await this.store.unpin(conversationId, messageId);
      return { ok: true, value: true };
    } catch (error) {
      return this.refusal(error);
    }
  }

  /**
   * `null` when the viewer may act on this message, or the refusal that stops
   * them. A message in a conversation they are not in is "not found" for the
   * same reason the conversation itself is.
   */
  private async owned(
    viewerId: string,
    conversationId: string,
    messageId: string,
  ): Promise<ConversationOutcome<true> | null> {
    const row = await this.store.participation(conversationId, viewerId);
    if (row === null) return { ok: false, reason: 'not_found' };
    if (!(await this.store.messageInConversation(conversationId, messageId))) {
      return { ok: false, reason: 'not_found' };
    }
    return null;
  }

  /** The author takes their own message down. A moderator's removal is T-212's. */
  async removeOwn(
    viewerId: string,
    conversationId: string,
    messageId: string,
  ): Promise<ConversationOutcome<true>> {
    const row = await this.store.participation(conversationId, viewerId);
    if (row === null) return { ok: false, reason: 'not_found' };
    if (!(await this.store.removeOwn(conversationId, messageId, viewerId))) {
      // Not theirs, already removed, or no such message: one answer, because
      // three would say which.
      return { ok: false, reason: 'not_found' };
    }
    return { ok: true, value: true };
  }

  async markRead(viewerId: string, conversationId: string, seq: number): Promise<boolean> {
    const row = await this.store.participation(conversationId, viewerId);
    if (row === null) return false;
    await this.store.markRead(conversationId, viewerId, seq);
    return true;
  }

  async setMuted(viewerId: string, conversationId: string, muted: boolean): Promise<boolean> {
    const row = await this.store.participation(conversationId, viewerId);
    if (row === null) return false;
    await this.store.setMuted(conversationId, viewerId, muted);
    return true;
  }

  /**
   * Leaving a direct conversation, and only a direct one.
   *
   * A group conversation's membership is the group's (T-245), so `left_at` here
   * would change nothing and the caller would be told it had worked. Saying so
   * is the whole point: a silent no-op is the failure rule 3 exists to prevent,
   * wearing the shape of a success.
   *
   * It is also the honest product answer. There are not two ways out of a group
   * that mean different things -- there is one, and it is leaving the group.
   */
  async leave(viewerId: string, conversationId: string): Promise<'left' | 'not_found' | 'group'> {
    const row = await this.store.participation(conversationId, viewerId);
    if (row === null) return 'not_found';
    if (row.kind === 'group') return 'group';
    await this.store.leave(conversationId, viewerId);
    return 'left';
  }

  /** The contact sanction behind a PL004, so a refusal can be explained. */
  messagingRestriction(userId: string) {
    return this.moderation.activeSanction(userId, 'messaging');
  }

  private refusal<T>(error: unknown): ConversationOutcome<T> {
    const code = (error as { code?: string }).code;
    if (code === BLOCKED) return { ok: false, reason: 'unavailable' };
    if (code === SANCTIONED) return { ok: false, reason: 'restricted' };
    if (code === OVER_RATE) return { ok: false, reason: 'rate_limited' };
    if (code === NOT_A_PARTICIPANT) return { ok: false, reason: 'left' };
    // A reaction or a pin on a tombstone. Caught here rather than checked
    // first, like every other refusal on this surface.
    if (code === ALREADY_REMOVED) return { ok: false, reason: 'removed' };
    throw error;
  }
}

function summary(
  row: ConversationRow,
  members: ConversationSummary['members'],
  latest: MessageRow | null,
  cards: CardLookup,
  marks: Marks,
): ConversationSummary {
  return {
    id: row.id,
    kind: row.kind as ConversationKind,
    // Non-null exactly when the conversation is a group's, and `members` is
    // empty exactly then: a group conversation is not a conversation *with*
    // particular people, and its membership is the group's to show (T-245).
    group:
      row.group_slug === null || row.group_name === null
        ? null
        : { slug: row.group_slug, name: row.group_name },
    members,
    last_message: latest === null ? null : message(latest, cards, marks),
    unread: Number(row.unread),
    muted: row.muted,
    left: row.left,
    their_read_seq: row.their_read_seq === null ? null : Number(row.their_read_seq),
  };
}
