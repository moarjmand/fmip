import type { Pool } from 'pg';

/** A link as its managers read it, with its state decided by the database clock. */
export interface LinkRow {
  id: string;
  created_by: string | null;
  created_at: Date;
  expires_at: Date;
  max_uses: number;
  uses: number;
  revoked_at: Date | null;
  state: string;
}

/** A link found by its token's hash, with its group and whether the viewer is in it. */
export interface LinkPreviewRow {
  group_id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: string;
  group_created_at: Date;
  member_count: string;
  state: string;
  member: boolean;
}

export interface FollowRow {
  outcome: string;
  group_id: string;
  visibility: string;
}

/**
 * The one copy of a link's state in SQL, the same order of questions
 * `group_invite_link_follow()` asks: revoked, expired, used up, then whether
 * its maker may still invite.
 */
const STATE = `CASE
    WHEN l.revoked_at IS NOT NULL THEN 'revoked'
    WHEN l.expires_at <= now() THEN 'expired'
    WHEN l.uses >= l.max_uses THEN 'exhausted'
    WHEN NOT group_may_invite(l.group_id, l.created_by) THEN 'orphaned'
    ELSE 'live'
  END`;

const LINK_COLUMNS = `l.id, u.username AS created_by, l.created_at, l.expires_at, l.max_uses,
       l.uses, l.revoked_at, ${STATE} AS state`;

/**
 * Every statement about invite links (T-1021, D-132). Who may make one, the
 * gates a follow passes and the use count are the schema's; this store writes
 * what it is told and reads back what the database decided.
 */
export class InviteLinksStore {
  constructor(private readonly pool: Pool) {}

  async create(
    groupId: string,
    by: string,
    tokenHash: string,
    hours: number,
    maxUses: number,
  ): Promise<LinkRow> {
    const { rows } = await this.pool.query<LinkRow>(
      `WITH made AS (
         INSERT INTO group_invite_link (group_id, token_hash, created_by, expires_at, max_uses)
         VALUES ($1, $2, $3, now() + make_interval(hours => $4::int), $5)
         RETURNING *
       )
       SELECT ${LINK_COLUMNS} FROM made l JOIN user_account u ON u.id = l.created_by`,
      [groupId, tokenHash, by, hours, maxUses],
    );
    return rows[0] as LinkRow;
  }

  /** A group's links, newest first; with `by`, only the ones that member made. */
  async list(groupId: string, by?: string): Promise<LinkRow[]> {
    const { rows } = await this.pool.query<LinkRow>(
      `SELECT ${LINK_COLUMNS}
         FROM group_invite_link l
         LEFT JOIN user_account u ON u.id = l.created_by
        WHERE l.group_id = $1 AND ($2::uuid IS NULL OR l.created_by = $2::uuid)
        ORDER BY l.created_at DESC
        LIMIT 100`,
      [groupId, by ?? null],
    );
    return rows;
  }

  /** Revoke once. With `by`, only a link that member made. False when nothing changed. */
  async revoke(groupId: string, linkId: string, actor: string, by?: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE group_invite_link
          SET revoked_at = now(), revoked_by = $3
        WHERE id = $2 AND group_id = $1 AND revoked_at IS NULL
          AND ($4::uuid IS NULL OR created_by = $4::uuid)`,
      [groupId, linkId, actor, by ?? null],
    );
    return rowCount === 1;
  }

  async preview(tokenHash: string, viewerId: string): Promise<LinkPreviewRow | null> {
    const { rows } = await this.pool.query<LinkPreviewRow>(
      `SELECT g.id AS group_id, g.slug, g.name, g.description, g.visibility,
              g.created_at AS group_created_at,
              (SELECT count(*) FROM group_member m WHERE m.group_id = g.id) AS member_count,
              ${STATE} AS state,
              EXISTS (SELECT 1 FROM group_member m
                       WHERE m.group_id = g.id AND m.user_id = $2) AS member
         FROM group_invite_link l
         JOIN user_group g ON g.id = l.group_id
        WHERE l.token_hash = $1`,
      [tokenHash, viewerId],
    );
    return rows[0] ?? null;
  }

  /** Follow: the whole of it is `group_invite_link_follow()`, one statement. */
  async follow(tokenHash: string, viewerId: string): Promise<FollowRow | null> {
    const { rows } = await this.pool.query<FollowRow>(
      `SELECT outcome, group_id, visibility FROM group_invite_link_follow($1, $2)`,
      [tokenHash, viewerId],
    );
    return rows[0] ?? null;
  }
}
