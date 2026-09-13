import { Inject, Injectable } from '@nestjs/common';
import type { Pool } from 'pg';
import type { BlockedMember, Friend, FriendRequest, FriendStatus } from '@fmip/contracts';
import { PG_POOL } from '../../database/database.module';
import { ModerationService } from '../moderation/moderation.service';
import { SocialStore } from './internal/social-store';

/** SQLSTATE raised by the T-200 triggers when a block stands between two members. */
const BLOCKED = 'PL003';
/** SQLSTATE raised by the T-210 trigger when the writer is under a contact sanction. */
const SANCTIONED = 'PL004';

/**
 * What a caller is allowed to do, or the reason they are not.
 *
 * `unavailable` is returned when the *other* member has blocked the viewer, and
 * it is deliberately the same answer the contract gives: a request cannot be
 * sent, and not why. See `FriendStatus` in `@fmip/contracts` for the argument.
 */
export type SocialOutcome =
  | { ok: true; changed: boolean }
  | {
      ok: false;
      reason: 'unknown_member' | 'self' | 'unavailable' | 'email_unverified' | 'restricted';
    };

/**
 * The social graph boundary (blueprint 8.1, T-201).
 *
 * Two rules run through the whole service, and both are about which direction a
 * gate points.
 *
 * **Reaching another member is gated; getting away from one never is.** Sending
 * a friend request needs a verified e-mail, for the same reason submitting a
 * prediction does (T-050): an unverified account is free to create and a
 * request is contact. Blocking, unblocking, declining and unfriending need
 * nothing beyond a session. A product that made somebody verify an e-mail
 * before they could stop a member contacting them would have built the gate
 * backwards.
 *
 * **The refusals are the database's.** A block is enforced by trigger (T-200),
 * so this service catches SQLSTATE PL003 and turns it into a sentence rather
 * than checking first and hoping nothing changed in between.
 */
@Injectable()
export class SocialService {
  private readonly store: SocialStore;

  constructor(
    @Inject(PG_POOL) pool: Pool,
    private readonly moderation: ModerationService,
  ) {
    this.store = new SocialStore(pool);
  }

  async friends(viewerId: string): Promise<Friend[]> {
    const rows = await this.store.friends(viewerId);
    return rows.map((row) => ({
      member: { username: row.username, display_name: row.display_name },
      friends_since: row.friends_since.toISOString(),
      mutual_friends: Number(row.mutual),
    }));
  }

  async requests(
    viewerId: string,
  ): Promise<{ incoming: FriendRequest[]; outgoing: FriendRequest[] }> {
    const [incoming, outgoing] = await Promise.all([
      this.store.incoming(viewerId),
      this.store.outgoing(viewerId),
    ]);
    const shape = (row: {
      username: string;
      display_name: string;
      sent_at: Date;
    }): FriendRequest => ({
      member: { username: row.username, display_name: row.display_name },
      sent_at: row.sent_at.toISOString(),
    });
    return { incoming: incoming.map(shape), outgoing: outgoing.map(shape) };
  }

  async blocked(viewerId: string): Promise<BlockedMember[]> {
    const rows = await this.store.blocks(viewerId);
    return rows.map((row) => ({
      member: { username: row.username, display_name: row.display_name },
      blocked_at: row.blocked_at.toISOString(),
    }));
  }

  /**
   * Where the viewer stands with another member.
   *
   * The order matters. A block the viewer placed is reported before anything
   * else, because it is theirs and they may want to undo it; a block *of* the
   * viewer is reported as `unavailable`, which says what they can do and not
   * what was done to them.
   */
  async status(viewerId: string, username: string): Promise<FriendStatus | null> {
    const other = await this.store.memberByUsername(username);
    if (other === null) return null;
    if (other.id === viewerId) return 'self';

    const blocks = await this.store.blockDirection(viewerId, other.id);
    if (blocks.byViewer) return 'blocked';
    if (blocks.ofViewer) return 'unavailable';
    if (await this.store.areFriends(viewerId, other.id)) return 'friends';

    const open = await this.store.openRequest(viewerId, other.id);
    if (open.sent) return 'request_sent';
    if (open.received) return 'request_received';
    return 'none';
  }

  /** Send a friend request. Idempotent: asking twice is one open offer. */
  async request(
    viewer: { id: string; emailVerified: boolean },
    username: string,
  ): Promise<SocialOutcome> {
    const other = await this.store.memberByUsername(username);
    if (other === null) return { ok: false, reason: 'unknown_member' };
    if (other.id === viewer.id) return { ok: false, reason: 'self' };
    if (!viewer.emailVerified) return { ok: false, reason: 'email_unverified' };

    try {
      return { ok: true, changed: await this.store.request(viewer.id, other.id) };
    } catch (error) {
      if (isBlocked(error)) return { ok: false, reason: 'unavailable' };
      if (isSanctioned(error)) return { ok: false, reason: 'restricted' };
      throw error;
    }
  }

  /**
   * Accept an incoming request. Needs a verified e-mail like sending one does:
   * accepting is how a member becomes reachable, and it is the same act from
   * the other end.
   */
  async accept(
    viewer: { id: string; emailVerified: boolean },
    username: string,
  ): Promise<SocialOutcome> {
    const other = await this.store.memberByUsername(username);
    if (other === null) return { ok: false, reason: 'unknown_member' };
    if (other.id === viewer.id) return { ok: false, reason: 'self' };
    if (!viewer.emailVerified) return { ok: false, reason: 'email_unverified' };

    try {
      return { ok: true, changed: await this.store.accept(viewer.id, other.id) };
    } catch (error) {
      if (isBlocked(error)) return { ok: false, reason: 'unavailable' };
      if (isSanctioned(error)) return { ok: false, reason: 'restricted' };
      throw error;
    }
  }

  /** Decline an incoming request, or cancel one sent. The same row either way. */
  async withdraw(viewerId: string, username: string): Promise<SocialOutcome> {
    const other = await this.resolve(viewerId, username);
    if ('reason' in other) return other;
    return { ok: true, changed: (await this.store.withdrawRequests(viewerId, other.id)) > 0 };
  }

  async unfriend(viewerId: string, username: string): Promise<SocialOutcome> {
    const other = await this.resolve(viewerId, username);
    if ('reason' in other) return other;
    return { ok: true, changed: await this.store.unfriend(viewerId, other.id) };
  }

  /** Block. Never gated beyond a session: it is the exit. */
  async block(viewerId: string, username: string): Promise<SocialOutcome> {
    const other = await this.store.memberByUsername(username);
    if (other === null) return { ok: false, reason: 'unknown_member' };
    if (other.id === viewerId) return { ok: false, reason: 'self' };
    await this.store.block(viewerId, other.id);
    return { ok: true, changed: true };
  }

  async unblock(viewerId: string, username: string): Promise<SocialOutcome> {
    const other = await this.resolve(viewerId, username);
    if ('reason' in other) return other;
    return { ok: true, changed: await this.store.unblock(viewerId, other.id) };
  }

  /**
   * The other member, or why there is not one.
   *
   * Every one of these verbs refuses the viewer's own username, including the
   * ones where operating on yourself would simply do nothing. "Nothing to do"
   * and "you asked the wrong question" look identical from outside, and the
   * lenient version of this cost an hour: a test that withdrew a request
   * between a member and themselves passed with a 204 and a stale request.
   */
  private async resolve(
    viewerId: string,
    username: string,
  ): Promise<{ id: string } | { ok: false; reason: 'unknown_member' | 'self' }> {
    const other = await this.store.memberByUsername(username);
    if (other === null) return { ok: false, reason: 'unknown_member' };
    if (other.id === viewerId) return { ok: false, reason: 'self' };
    return { id: other.id };
  }

  /**
   * The contact sanction that just stopped this member, if there is one.
   *
   * Asked **after** the database has refused (PL004), never before. Checking
   * first and then writing would be a check a sanction expiring in between
   * could make wrong, and it would put a second copy of the rule in TypeScript.
   * This is the explanation, not the gate.
   */
  restriction(userId: string) {
    return this.moderation.activeSanction(userId, 'contact');
  }

  /** What the profile boundary's `FriendshipOracle` asks. */
  areFriends(a: string, b: string): Promise<boolean> {
    return this.store.areFriends(a, b);
  }
}

interface Codeful {
  code?: string;
}

function isBlocked(error: unknown): boolean {
  return (error as Codeful).code === BLOCKED;
}

function isSanctioned(error: unknown): boolean {
  return (error as Codeful).code === SANCTIONED;
}
