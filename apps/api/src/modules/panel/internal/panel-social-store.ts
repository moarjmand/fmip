import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/**
 * The SQL for panel reactions and member follows (T-252). All of it, and
 * nothing else.
 *
 * **Nothing here asks whether the actor holds a contributor grant**, and that
 * is the task's whole point rather than an omission. Reacting and following are
 * open to any member; a check for approval in this file would be the second,
 * quieter gate the acceptance criterion exists to forbid.
 *
 * The refusals it does pass on are the database's: a block (`PL003`), and a
 * reaction to a post that has been taken down (`PL007`).
 */

export interface ReactionRow {
  post_id: string;
  reaction: string;
  count: string;
}

export interface MyReactionRow {
  post_id: string;
  reaction: string;
}

export interface FollowedRow {
  username: string;
  display_name: string;
  rating: string | null;
  approved: boolean;
  since: Date;
}

@Injectable()
export class PostgresPanelSocialStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * Every reaction count on a page of posts, in one query.
   *
   * One query for the page rather than one per post: a panel of fifty posts
   * would otherwise cost fifty round trips to draw the cheapest thing on the
   * screen.
   *
   * It takes no viewer, and the counts it returns are the same for everybody.
   * Who reacted is `myReactions` below, on the request that already depends on
   * who is asking.
   */
  async tallies(postIds: string[]): Promise<ReactionRow[]> {
    if (postIds.length === 0) return [];
    const { rows } = await this.pool.query<ReactionRow>(
      `SELECT post_id, reaction, count(*)::text AS count
         FROM panel_reaction
        WHERE post_id = ANY($1::uuid[])
        GROUP BY post_id, reaction
        ORDER BY post_id, reaction`,
      [postIds],
    );
    return rows;
  }

  /** What this member has left on one fixture's panel. Scoped to the fixture, not the page:
   *  the client pages through posts and should not have to re-ask which of them are theirs. */
  async myReactions(fixtureId: string, userId: string): Promise<MyReactionRow[]> {
    const { rows } = await this.pool.query<MyReactionRow>(
      `SELECT r.post_id, r.reaction
         FROM panel_reaction r
         JOIN panel_post p ON p.id = r.post_id
        WHERE p.fixture_id = $1 AND r.user_id = $2
        ORDER BY r.post_id, r.reaction`,
      [fixtureId, userId],
    );
    return rows;
  }

  /**
   * React, or do nothing if this member already reacted that way.
   *
   * `ON CONFLICT DO NOTHING` rather than a lookup first: two taps would both
   * pass a lookup and only one should write, and reacting twice is reacting
   * once. The triggers still run, so a removed post still refuses.
   */
  async react(postId: string, userId: string, reaction: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO panel_reaction (post_id, user_id, reaction)
       VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`,
      [postId, userId, reaction],
    );
  }

  /** Take a reaction back. Silent when there was none: the end state is what was asked for. */
  async unreact(postId: string, userId: string, reaction: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM panel_reaction WHERE post_id = $1 AND user_id = $2 AND reaction = $3`,
      [postId, userId, reaction],
    );
  }

  /**
   * Who wrote a post, or null if there is no such post.
   *
   * One query where "does it exist" and "who wrote it" were two: reacting needs
   * both -- the first to answer a bad id, the second to know whom to tell
   * (T-271) -- and asking twice would be two round trips for one fact.
   */
  async authorOf(postId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ author_id: string }>(
      `SELECT author_id FROM panel_post WHERE id = $1`,
      [postId],
    );
    return rows[0]?.author_id ?? null;
  }

  /** Whom this member follows, with each one's standing as it is now. */
  async following(userId: string): Promise<FollowedRow[]> {
    const { rows } = await this.pool.query<FollowedRow>(
      `SELECT u.username,
              u.display_name,
              r.rating,
              member_may_contribute(u.id) AS approved,
              f.created_at AS since
         FROM member_follow f
         JOIN user_account u ON u.id = f.followed_id
         LEFT JOIN LATERAL (
           SELECT s.rating FROM rating_snapshot s
            WHERE s.user_id = f.followed_id
            ORDER BY s.computed_at DESC, s.id DESC
            LIMIT 1
         ) r ON true
        WHERE f.follower_id = $1
        ORDER BY f.created_at DESC`,
      [userId],
    );
    return rows;
  }

  /** Follow. Idempotent, and the block trigger still decides (`PL003`). */
  async follow(followerId: string, followedId: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO member_follow (follower_id, followed_id) VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [followerId, followedId],
    );
  }

  async unfollow(followerId: string, followedId: string): Promise<void> {
    await this.pool.query(`DELETE FROM member_follow WHERE follower_id = $1 AND followed_id = $2`, [
      followerId,
      followedId,
    ]);
  }

  /**
   * The follower count, and whether the viewer is one of them.
   *
   * The count is public either way: it is a fact about a contributor that
   * anybody reading the panel can see, and hiding it from a guest would make
   * the number change when somebody signs in.
   */
  async followState(
    followedId: string,
    viewer: string | null,
  ): Promise<{ followers: number; following: boolean }> {
    const { rows } = await this.pool.query<{ followers: string; following: boolean }>(
      `SELECT count(*)::text AS followers,
              bool_or(follower_id = $2::uuid) AS following
         FROM member_follow WHERE followed_id = $1`,
      [followedId, viewer],
    );
    return {
      followers: Number(rows[0]?.followers ?? '0'),
      following: rows[0]?.following ?? false,
    };
  }

  /** Whether either has blocked the other, through the one definition of it (T-200). */
  async blocked(a: string, b: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ yes: boolean }>(
      `SELECT users_blocked($1, $2) AS yes`,
      [a, b],
    );
    return rows[0]?.yes ?? false;
  }
}
