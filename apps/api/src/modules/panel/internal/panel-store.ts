import { Inject, Injectable } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/**
 * The SQL for the public match panel (T-251). All of it, and nothing else.
 *
 * The gate is not here. Whether a member may post is decided by the three
 * triggers on `panel_post` — approval, sanction, ceiling — and this file writes
 * the row and lets them refuse it. A permission check in front of the INSERT
 * would be a second copy of a safety rule, and the copy that is wrong is always
 * the one somebody reads (`moderation-store.ts` makes the same argument).
 *
 * The permission endpoint above *does* ask, and that is not the same thing: it
 * is telling a member what would happen, not deciding what does.
 */

export interface PanelPostRow {
  id: string;
  username: string;
  display_name: string;
  rating: string | null;
  body: string | null;
  created_at: Date;
  /**
   * `created_at` as Postgres renders it, to microseconds.
   *
   * The cursor is built from this and never from `created_at`, because a
   * `timestamptz` arrives in JavaScript as a `Date` and a `Date` holds
   * milliseconds. Rounding the microseconds off makes the cursor sort *before*
   * the row it points at, so the last post of every page comes back again at
   * the top of the next one -- a duplicate nobody would call a bug report, and
   * exactly the kind of paging fault that survives review.
   */
  created_text: string;
  removed_kind: string | null;
  /** Whether the author holds a live grant **now**, not when they wrote it. */
  approved: boolean;
}

export interface PanelPage {
  rows: PanelPostRow[];
  /** Every post on this panel, removed ones included. */
  total: number;
}

/**
 * A page position: the `created_at` and `id` of the last post returned.
 *
 * Opaque to the client on purpose. A numeric offset would skip or repeat a post
 * whenever one was written between two requests, and a bare timestamp would tie
 * two posts written in the same millisecond.
 */
export interface PanelCursor {
  at: string;
  id: string;
}

export function encodeCursor(at: string, id: string): string {
  return Buffer.from(`${at}|${id}`, 'utf8').toString('base64url');
}

/** Null for anything that is not a cursor this server wrote. */
export function decodeCursor(raw: string | undefined): PanelCursor | null {
  if (raw === undefined || raw === '') return null;
  const text = Buffer.from(raw, 'base64url').toString('utf8');
  const [at, id] = text.split('|');
  if (at === undefined || id === undefined) return null;
  if (Number.isNaN(Date.parse(at))) return null;
  if (!/^[0-9a-f-]{36}$/.test(id)) return null;
  return { at, id };
}

@Injectable()
export class PostgresPanelStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /**
   * One page, oldest first, with the author's standing as it is now.
   *
   * Removed posts are **returned**, as tombstones. A panel that silently
   * dropped them would leave a conversation with holes in it, and a reply to
   * something that is no longer there reads as a non sequitur rather than as a
   * reply to something taken down (rule 3).
   */
  async page(fixtureId: string, after: PanelCursor | null, limit: number): Promise<PanelPage> {
    const { rows } = await this.pool.query<PanelPostRow>(
      `SELECT p.id,
              u.username,
              u.display_name,
              r.rating,
              p.body,
              p.created_at,
              p.created_at::text AS created_text,
              p.removed_kind,
              member_may_contribute(p.author_id) AS approved
         FROM panel_post p
         JOIN user_account u ON u.id = p.author_id
         LEFT JOIN LATERAL (
           SELECT s.rating FROM rating_snapshot s
            WHERE s.user_id = p.author_id
            ORDER BY s.computed_at DESC, s.id DESC
            LIMIT 1
         ) r ON true
        WHERE p.fixture_id = $1
          AND ($2::timestamptz IS NULL
               OR (p.created_at, p.id) > ($2::timestamptz, $3::uuid))
        ORDER BY p.created_at, p.id
        LIMIT $4`,
      [fixtureId, after?.at ?? null, after?.id ?? null, limit],
    );
    const counted = await this.pool.query<{ total: string }>(
      `SELECT count(*)::text AS total FROM panel_post WHERE fixture_id = $1`,
      [fixtureId],
    );
    return { rows, total: Number(counted.rows[0]?.total ?? '0') };
  }

  /**
   * Whether a `post` sanction is in force on this member.
   *
   * Specifically `post`, and not "any sanction": a contact restriction stops
   * friend requests and nothing else. Blueprint 10.4's ladder is per behaviour,
   * and a scope that leaked into every surface would be a permanent ban issued
   * by accident.
   */
  async postSanctioned(userId: string): Promise<boolean> {
    const { rows } = await this.pool.query<{ yes: boolean }>(
      `SELECT member_sanctioned($1, 'post') AS yes`,
      [userId],
    );
    return rows[0]?.yes ?? false;
  }

  /** Whether the fixture exists at all, so an unknown match is a 404 and not an empty panel. */
  async fixtureExists(fixtureId: string): Promise<boolean> {
    const { rows } = await this.pool.query(`SELECT 1 FROM fixture WHERE id = $1`, [fixtureId]);
    return rows.length === 1;
  }

  /**
   * Whether this match has a discussion, and whether it is still open (T-253).
   *
   * Three answers, not two. "Nobody opened one" and "one was opened and nobody
   * has spoken" are different facts, and a reader can act on the second (rule
   * 3). `null` here means the first.
   */
  async panelState(fixtureId: string): Promise<'none' | 'open' | 'closed'> {
    const { rows } = await this.pool.query<{ closed: boolean }>(
      `SELECT (closed_at IS NOT NULL) AS closed FROM match_panel WHERE fixture_id = $1`,
      [fixtureId],
    );
    const row = rows[0];
    if (row === undefined) return 'none';
    return row.closed ? 'closed' : 'open';
  }

  /** Writes the post and lets the triggers refuse it. */
  async write(fixtureId: string, authorId: string, body: string): Promise<PanelPostRow> {
    const { rows } = await this.pool.query<{ id: string }>(
      `INSERT INTO panel_post (fixture_id, author_id, body) VALUES ($1, $2, $3) RETURNING id`,
      [fixtureId, authorId, body],
    );
    const written = await this.byId(rows[0]?.id ?? '');
    if (written === null) throw new Error('the post was written and then could not be read back');
    return written;
  }

  async byId(postId: string): Promise<PanelPostRow | null> {
    const { rows } = await this.pool.query<PanelPostRow>(
      `SELECT p.id, u.username, u.display_name, r.rating, p.body, p.created_at,
              p.created_at::text AS created_text, p.removed_kind,
              member_may_contribute(p.author_id) AS approved
         FROM panel_post p
         JOIN user_account u ON u.id = p.author_id
         LEFT JOIN LATERAL (
           SELECT s.rating FROM rating_snapshot s
            WHERE s.user_id = p.author_id
            ORDER BY s.computed_at DESC, s.id DESC
            LIMIT 1
         ) r ON true
        WHERE p.id = $1`,
      [postId],
    );
    return rows[0] ?? null;
  }

  /**
   * The author taking their own post down.
   *
   * `author_id = $2` in the WHERE rather than a read-then-check: two taps on
   * different machines would both pass a check and only one should write, and
   * the row that is not theirs must not be found at all.
   */
  async removeOwn(postId: string, authorId: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE panel_post
          SET removed_at = now(), removed_by = $2, removed_kind = 'author', body = NULL
        WHERE id = $1 AND author_id = $2 AND removed_at IS NULL`,
      [postId, authorId],
    );
    return rowCount === 1;
  }
}
