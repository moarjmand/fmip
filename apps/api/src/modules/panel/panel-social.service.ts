import { Injectable } from '@nestjs/common';
import type {
  FollowStatus,
  FollowedMember,
  FollowedMembersResponse,
  MyPostReactions,
  PanelReaction,
  PanelReactionTally,
} from '@fmip/contracts';
import { IdentityService } from '../identity/identity.service';
import { PostgresPanelSocialStore } from './internal/panel-social-store';

/**
 * Reacting to a panel post, and following a contributor (blueprint 10.2,
 * T-252).
 *
 * **Everything here is open to any signed-in member.** There is no
 * `member_may_contribute` in this file and there should never be one: a check
 * for approval on reacting or following would be a second, quieter gate, and
 * the criterion this task is measured by is that neither of these becomes
 * posting access.
 *
 * What it does refuse is what the social graph already refuses everywhere else:
 * a block, in either direction, decided by `users_blocked` rather than by a
 * second opinion here (T-200).
 */

/** The database's word for "these two must not reach each other". */
const BLOCKED = 'PL003';
/** And for "that post has been taken down". */
const REMOVED = 'PL007';

export type ReactOutcome = 'ok' | 'no_post' | 'removed';
export type FollowOutcome = 'ok' | 'no_member' | 'blocked' | 'self';

function codeOf(error: unknown): string {
  return (error as { code?: string }).code ?? '';
}

@Injectable()
export class PanelSocialService {
  constructor(
    private readonly store: PostgresPanelSocialStore,
    private readonly identity: IdentityService,
  ) {}

  /**
   * The reaction counts on a page of posts, keyed by post id.
   *
   * A post with none gets an empty array rather than being absent from the map,
   * so a caller never has to tell "no reactions" apart from "not asked about".
   */
  async talliesFor(postIds: string[]): Promise<Map<string, PanelReactionTally[]>> {
    const byPost = new Map<string, PanelReactionTally[]>(postIds.map((id) => [id, []]));
    for (const row of await this.store.tallies(postIds)) {
      byPost.get(row.post_id)?.push({
        reaction: row.reaction as PanelReaction,
        count: Number(row.count),
      });
    }
    return byPost;
  }

  /** The viewer's own reactions across one fixture's panel. Empty for a guest. */
  async myReactions(fixtureId: string, viewer: string | null): Promise<MyPostReactions[]> {
    if (viewer === null) return [];
    const byPost = new Map<string, PanelReaction[]>();
    for (const row of await this.store.myReactions(fixtureId, viewer)) {
      const list = byPost.get(row.post_id) ?? [];
      list.push(row.reaction as PanelReaction);
      byPost.set(row.post_id, list);
    }
    return [...byPost].map(([post_id, reactions]) => ({ post_id, reactions }));
  }

  /** React, or take it back. Both idempotent: the end state is what was asked for. */
  async setReaction(
    postId: string,
    userId: string,
    reaction: PanelReaction,
    on: boolean,
  ): Promise<ReactOutcome> {
    if (!(await this.store.postExists(postId))) return 'no_post';
    try {
      if (on) await this.store.react(postId, userId, reaction);
      else await this.store.unreact(postId, userId, reaction);
    } catch (error) {
      if (codeOf(error) === REMOVED) return 'removed';
      throw error;
    }
    return 'ok';
  }

  async following(userId: string): Promise<FollowedMembersResponse> {
    const rows = await this.store.following(userId);
    return {
      following: rows.map((row): FollowedMember => ({
        username: row.username,
        display_name: row.display_name,
        // Null, not zero: somebody who has settled nothing has not been rated
        // badly.
        rating: row.rating === null ? null : Number(row.rating),
        approved: row.approved,
        since: row.since.toISOString(),
      })),
    };
  }

  /**
   * The viewer's relationship to one member, and that member's follower count.
   *
   * Null when there is no such member. A guest gets an answer too — the count is
   * public, and `following: false` is true of them rather than unknown.
   */
  async statusOf(username: string, viewer: string | null): Promise<FollowStatus | null> {
    const them = await this.identity.userByUsername(username.toLowerCase());
    if (them === null) return null;
    const { followers, following } = await this.store.followState(them.id, viewer);

    const refusal = await this.refusalFor(them.id, viewer, following);
    return { username: them.username, following, followers, refusal };
  }

  private async refusalFor(
    theirId: string,
    viewer: string | null,
    alreadyFollowing: boolean,
  ): Promise<FollowStatus['refusal']> {
    if (alreadyFollowing) return null;
    if (viewer === null) return 'not_signed_in';
    if (viewer === theirId) return 'self';
    // `blocked` whichever way round it goes. Saying which would let either of
    // them learn something about the other they were not told.
    return (await this.store.blocked(viewer, theirId)) ? 'blocked' : null;
  }

  /** Follow or unfollow. The block trigger decides; this reports what it said. */
  async setFollow(username: string, viewer: string, on: boolean): Promise<FollowOutcome> {
    const them = await this.identity.userByUsername(username.toLowerCase());
    if (them === null) return 'no_member';
    if (them.id === viewer) return 'self';
    try {
      if (on) await this.store.follow(viewer, them.id);
      else await this.store.unfollow(viewer, them.id);
    } catch (error) {
      if (codeOf(error) === BLOCKED) return 'blocked';
      throw error;
    }
    return 'ok';
  }
}
