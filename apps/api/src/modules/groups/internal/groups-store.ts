import type { Pool, PoolClient } from 'pg';

/** A group as every read of one returns it, with its size. */
export interface GroupRow {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  visibility: string;
  created_at: Date;
  member_count: string;
}

export interface MemberRow {
  username: string;
  display_name: string;
  role: string;
  joined_at: Date;
}

export interface InviteRow extends GroupRow {
  invited_by: string;
  invited_at: Date;
}

export interface RequestRow {
  username: string;
  display_name: string;
  note: string | null;
  created_at: Date;
}

/**
 * Every statement the groups boundary makes (T-241).
 *
 * The rules are not here. Who may be in a group, how many owners it has, which
 * visibility can be asked to join — all of that is the schema's (T-240,
 * D-057), and this store's job is to write what it is told and let the database
 * refuse what it must. A guard re-implemented in a query here would be a second
 * copy of a rule, and the second copy is the one that drifts.
 */
const GROUP_COLUMNS = `g.id, g.slug, g.name, g.description, g.visibility, g.created_at,
         (SELECT count(*) FROM group_member m WHERE m.group_id = g.id) AS member_count`;

export class GroupsStore {
  constructor(private readonly pool: Pool) {}

  async bySlug(slug: string): Promise<GroupRow | null> {
    const { rows } = await this.pool.query<GroupRow>(
      `SELECT ${GROUP_COLUMNS} FROM user_group g WHERE g.slug = $1`,
      [slug],
    );
    return rows[0] ?? null;
  }

  /**
   * The directory: everything that can be found.
   *
   * Invite-only groups are absent, not filtered out later — the partial index
   * behind this query does not contain them either, so there is no path by
   * which one could be listed.
   */
  async directory(term: string, limit: number): Promise<GroupRow[]> {
    const { rows } = await this.pool.query<GroupRow>(
      `SELECT ${GROUP_COLUMNS}
         FROM user_group g
        WHERE g.visibility <> 'invite_only'
          AND ($1 = '' OR search_key(g.name) LIKE '%' || search_key($1) || '%')
        ORDER BY member_count DESC, g.created_at DESC
        LIMIT $2`,
      [term, limit],
    );
    return rows;
  }

  /** Every group the viewer is in, whatever its visibility. */
  async mine(viewerId: string): Promise<GroupRow[]> {
    const { rows } = await this.pool.query<GroupRow>(
      `SELECT ${GROUP_COLUMNS}
         FROM user_group g
         JOIN group_member me ON me.group_id = g.id AND me.user_id = $1
        ORDER BY me.joined_at DESC`,
      [viewerId],
    );
    return rows;
  }

  async role(groupId: string, userId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ role: string }>(
      `SELECT role FROM group_member WHERE group_id = $1 AND user_id = $2`,
      [groupId, userId],
    );
    return rows[0]?.role ?? null;
  }

  async members(groupId: string): Promise<MemberRow[]> {
    const { rows } = await this.pool.query<MemberRow>(
      `SELECT u.username, u.display_name, m.role, m.joined_at
         FROM group_member m
         JOIN user_account u ON u.id = m.user_id
        WHERE m.group_id = $1
        ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END,
                 m.joined_at`,
      [groupId],
    );
    return rows;
  }

  /** What is waiting for whoever decides. */
  async pending(groupId: string): Promise<{ invites: number; requests: number }> {
    const { rows } = await this.pool.query<{ invites: string; requests: string }>(
      `SELECT (SELECT count(*) FROM group_invite WHERE group_id = $1) AS invites,
              (SELECT count(*) FROM group_join_request WHERE group_id = $1) AS requests`,
      [groupId],
    );
    return {
      invites: Number(rows[0]?.invites ?? 0),
      requests: Number(rows[0]?.requests ?? 0),
    };
  }

  /**
   * The group and its owner, in one transaction.
   *
   * One transaction because the owner rule is checked at commit (T-240): two
   * statements outside one would each be their own commit, and the first would
   * be a group with nobody in charge.
   */
  async create(
    slug: string,
    name: string,
    description: string | null,
    visibility: string,
    owner: string,
  ): Promise<GroupRow> {
    return this.inTransaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO user_group (slug, name, description, visibility, created_by)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [slug, name, description, visibility, owner],
      );
      const id = rows[0]?.id ?? '';
      await client.query(
        `INSERT INTO group_member (group_id, user_id, role) VALUES ($1, $2, 'owner')`,
        [id, owner],
      );
      // A group is a place to talk, so it has its conversation from the moment
      // it exists (T-245). Made here, in the same transaction, because a group
      // without one would be a group whose chat page 404s until somebody
      // noticed.
      await client.query(`INSERT INTO conversation (kind, group_id) VALUES ('group', $1)`, [id]);
      const { rows: made } = await client.query<GroupRow>(
        `SELECT ${GROUP_COLUMNS} FROM user_group g WHERE g.id = $1`,
        [id],
      );
      return made[0] as GroupRow;
    });
  }

  async update(
    groupId: string,
    patch: { name?: string; description?: string | null; visibility?: string },
  ): Promise<void> {
    await this.pool.query(
      `UPDATE user_group
          SET name = COALESCE($2, name),
              description = CASE WHEN $3::boolean THEN $4 ELSE description END,
              visibility = COALESCE($5, visibility)
        WHERE id = $1`,
      [
        groupId,
        patch.name ?? null,
        patch.description !== undefined,
        patch.description ?? null,
        patch.visibility ?? null,
      ],
    );
  }

  async remove(groupId: string): Promise<void> {
    await this.pool.query(`DELETE FROM user_group WHERE id = $1`, [groupId]);
  }

  /** `true` when the member was added, `false` when they were already in. */
  async addMember(groupId: string, userId: string, role = 'member'): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `INSERT INTO group_member (group_id, user_id, role) VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING`,
      [groupId, userId, role],
    );
    return rowCount === 1;
  }

  async removeMember(groupId: string, userId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM group_member WHERE group_id = $1 AND user_id = $2`,
      [groupId, userId],
    );
    return rowCount === 1;
  }

  async setRole(groupId: string, userId: string, role: string): Promise<void> {
    await this.pool.query(
      `UPDATE group_member SET role = $3 WHERE group_id = $1 AND user_id = $2`,
      [groupId, userId, role],
    );
  }

  /**
   * Hand the group over: demote, then promote, in one transaction.
   *
   * The only way the database allows it. The owner check is deferred precisely
   * so that the moment in between — a group with nobody in charge — can exist
   * inside a transaction and never at rest (T-240, D-057).
   */
  async handOver(groupId: string, from: string, to: string): Promise<void> {
    await this.inTransaction(async (client) => {
      await client.query(
        `UPDATE group_member SET role = 'member' WHERE group_id = $1 AND user_id = $2`,
        [groupId, from],
      );
      await client.query(
        `UPDATE group_member SET role = 'owner' WHERE group_id = $1 AND user_id = $2`,
        [groupId, to],
      );
    });
  }

  // -------------------------------------------------------------------------
  // Invitations
  // -------------------------------------------------------------------------

  async invite(groupId: string, invitee: string, by: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO group_invite (group_id, invitee_id, invited_by) VALUES ($1, $2, $3)`,
      [groupId, invitee, by],
    );
  }

  async hasInvite(groupId: string, invitee: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM group_invite WHERE group_id = $1 AND invitee_id = $2`,
      [groupId, invitee],
    );
    return rowCount === 1;
  }

  async withdrawInvite(groupId: string, invitee: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM group_invite WHERE group_id = $1 AND invitee_id = $2`,
      [groupId, invitee],
    );
    return rowCount === 1;
  }

  async invitesFor(userId: string): Promise<InviteRow[]> {
    const { rows } = await this.pool.query<InviteRow>(
      `SELECT ${GROUP_COLUMNS}, u.username AS invited_by, i.created_at AS invited_at
         FROM group_invite i
         JOIN user_group g ON g.id = i.group_id
         JOIN user_account u ON u.id = i.invited_by
        WHERE i.invitee_id = $1
        ORDER BY i.created_at DESC`,
      [userId],
    );
    return rows;
  }

  /** Accept: join and drop the offer, so neither can exist without the other. */
  async acceptInvite(groupId: string, userId: string): Promise<void> {
    await this.inTransaction(async (client) => {
      await client.query(
        `INSERT INTO group_member (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [groupId, userId],
      );
      await client.query(`DELETE FROM group_invite WHERE group_id = $1 AND invitee_id = $2`, [
        groupId,
        userId,
      ]);
    });
  }

  // -------------------------------------------------------------------------
  // Join requests
  // -------------------------------------------------------------------------

  async requestJoin(groupId: string, userId: string, note: string | null): Promise<void> {
    await this.pool.query(
      `INSERT INTO group_join_request (group_id, user_id, note) VALUES ($1, $2, $3)`,
      [groupId, userId, note],
    );
  }

  async hasRequest(groupId: string, userId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM group_join_request WHERE group_id = $1 AND user_id = $2`,
      [groupId, userId],
    );
    return rowCount === 1;
  }

  async requests(groupId: string): Promise<RequestRow[]> {
    const { rows } = await this.pool.query<RequestRow>(
      `SELECT u.username, u.display_name, r.note, r.created_at
         FROM group_join_request r
         JOIN user_account u ON u.id = r.user_id
        WHERE r.group_id = $1
        ORDER BY r.created_at`,
      [groupId],
    );
    return rows;
  }

  async dropRequest(groupId: string, userId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `DELETE FROM group_join_request WHERE group_id = $1 AND user_id = $2`,
      [groupId, userId],
    );
    return rowCount === 1;
  }

  async acceptRequest(groupId: string, userId: string): Promise<void> {
    await this.inTransaction(async (client) => {
      await client.query(
        `INSERT INTO group_member (group_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [groupId, userId],
      );
      await client.query(`DELETE FROM group_join_request WHERE group_id = $1 AND user_id = $2`, [
        groupId,
        userId,
      ]);
    });
  }

  // -------------------------------------------------------------------------

  /** A group's conversation. Every group has exactly one, by unique index. */
  async conversationFor(groupId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM conversation WHERE group_id = $1`,
      [groupId],
    );
    return rows[0]?.id ?? null;
  }

  /** A member by username, for every verb that names one. */
  async memberIdByUsername(username: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT id FROM user_account WHERE username = $1 AND status = 'active'`,
      [username.toLowerCase()],
    );
    return rows[0]?.id ?? null;
  }

  private async inTransaction<T>(run: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const value = await run(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
