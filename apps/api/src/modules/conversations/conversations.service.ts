import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import {
  type ConversationKind,
  type ConversationPage,
  type ConversationSummary,
  MAX_MESSAGE_LENGTH,
  MESSAGE_PAGE_SIZE,
  type Message,
  type MessageRemoval,
  type SendMessageRequest,
} from '@fmip/contracts';
import { PG_POOL } from '../../database/database.module';
import { ModerationService } from '../moderation/moderation.service';
import {
  type ConversationRow,
  ConversationsStore,
  type MessageRow,
} from './internal/conversations-store';

/** SQLSTATEs the T-220 triggers raise. */
const BLOCKED = 'PL003';
const SANCTIONED = 'PL004';
const NOT_A_PARTICIPANT = 'PL006';
const OVER_RATE = 'PL005';

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
        | 'invalid';
      fields?: Record<string, string>;
    };

function message(row: MessageRow): Message {
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
  };
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
  private readonly store: ConversationsStore;

  constructor(
    @Inject(PG_POOL) pool: Pool,
    private readonly moderation: ModerationService,
  ) {
    this.store = new ConversationsStore(pool);
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

    return rows.map((row) => summary(row, members.get(row.id) ?? [], latest.get(row.id) ?? null));
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

    return {
      conversation: summary(
        row,
        participants.map((p) => ({ username: p.username, display_name: p.display_name })),
        latest.get(conversationId) ?? null,
      ),
      messages: messages.map(message),
      latest_seq: Number(row.latest_seq),
      has_earlier: hasEarlier,
    };
  }

  async send(
    viewerId: string,
    conversationId: string,
    body: SendMessageRequest,
  ): Promise<ConversationOutcome<Message>> {
    const text = typeof body?.body === 'string' ? body.body.trim() : '';
    if (text === '') {
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

    try {
      return {
        ok: true,
        value: message(await this.store.send(conversationId, viewerId, text, replyTo)),
      };
    } catch (error) {
      return this.refusal(error);
    }
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

  async leave(viewerId: string, conversationId: string): Promise<boolean> {
    const row = await this.store.participation(conversationId, viewerId);
    if (row === null) return false;
    await this.store.leave(conversationId, viewerId);
    return true;
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
    throw error;
  }
}

function summary(
  row: ConversationRow,
  members: ConversationSummary['members'],
  latest: MessageRow | null,
): ConversationSummary {
  return {
    id: row.id,
    kind: row.kind as ConversationKind,
    members,
    last_message: latest === null ? null : message(latest),
    unread: Number(row.unread),
    muted: row.muted,
    left: row.left,
    their_read_seq: row.their_read_seq === null ? null : Number(row.their_read_seq),
  };
}
