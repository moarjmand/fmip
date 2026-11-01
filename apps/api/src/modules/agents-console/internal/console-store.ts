import { Inject, Injectable } from '@nestjs/common';
import type {
  ConsoleAuditEntry,
  ConsoleBoardCard,
  ConsoleBoardCardInput,
  ConsoleBoardColumn,
  ConsoleCommand,
  ConsoleCommandRequest,
  ConsoleMe,
  ConsoleSnapshot,
} from '@fmip/contracts';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import { SESSION_IDLE_HOURS } from './console-rules';

export interface ConsoleUserRow {
  id: string;
  username: string;
  display_name: string;
  password_hash: string;
  failed_logins: number;
  locked_until: Date | null;
  disabled_at: Date | null;
}

export interface AuditInput {
  actorId: string | null;
  actorName: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string;
  previous?: unknown;
  next?: unknown;
}

interface CardRow {
  id: string;
  title: string;
  body: string;
  column_key: string;
  position: number;
  labels: string[];
  assignee: string | null;
  due_on: string | null;
  updated_by: string | null;
  updated_at: Date;
}

const CARD_COLUMNS = `c.id, c.title, c.body, c.column_key, c.position, c.labels, c.assignee,
  to_char(c.due_on, 'YYYY-MM-DD') AS due_on, u.display_name AS updated_by, c.updated_at`;

const card = (r: CardRow): ConsoleBoardCard => ({
  id: r.id,
  title: r.title,
  body: r.body,
  column: r.column_key as ConsoleBoardColumn,
  position: r.position,
  labels: r.labels,
  assignee: r.assignee,
  due_on: r.due_on,
  updated_by: r.updated_by,
  updated_at: r.updated_at.toISOString(),
});

interface CommandRow {
  id: string;
  kind: ConsoleCommand['kind'];
  target: string;
  payload: Record<string, string>;
  status: ConsoleCommand['status'];
  requested_by: string;
  requested_at: Date;
  finished_at: Date | null;
  outcome: string | null;
}

const command = (r: CommandRow): ConsoleCommand => ({
  id: r.id,
  kind: r.kind,
  target: r.target,
  payload: r.payload,
  status: r.status,
  requested_by: r.requested_by,
  requested_at: r.requested_at.toISOString(),
  finished_at: r.finished_at?.toISOString() ?? null,
  outcome: r.outcome,
});

/**
 * The agents console's tables (T-1696, T-1697, D-340). Every change a person
 * makes is written with its `console_audit` row in the same transaction
 * (rule 10); a failed sign-in is audited with the name that was tried.
 */
@Injectable()
export class PostgresConsoleStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  // --- Accounts ------------------------------------------------------------

  async userByName(username: string): Promise<ConsoleUserRow | null> {
    const { rows } = await this.pool.query<ConsoleUserRow>(
      `SELECT id, username, display_name, password_hash, failed_logins, locked_until, disabled_at
         FROM console_user WHERE username = $1`,
      [username],
    );
    return rows[0] ?? null;
  }

  async signedIn(userId: string): Promise<void> {
    await this.transaction(async (client) => {
      const { rows } = await client.query<{ username: string }>(
        `UPDATE console_user SET failed_logins = 0, locked_until = NULL, last_login_at = now()
          WHERE id = $1 RETURNING username`,
        [userId],
      );
      await this.audit(client, {
        actorId: userId,
        actorName: rows[0]?.username ?? '?',
        action: 'console.sign_in',
        targetType: 'console_user',
        targetId: userId,
        reason: 'signed in',
      });
    });
  }

  /** A wrong password for a known name, or a name that does not exist (`userId` null). */
  async failedSignIn(
    username: string,
    userId: string | null,
    failures: number,
    lockedUntil: Date | null,
  ): Promise<void> {
    await this.transaction(async (client) => {
      if (userId !== null) {
        await client.query(
          `UPDATE console_user SET failed_logins = $2, locked_until = COALESCE($3, locked_until) WHERE id = $1`,
          [userId, failures, lockedUntil],
        );
      }
      await this.audit(client, {
        actorId: null,
        actorName: username.slice(0, 64),
        action: lockedUntil === null ? 'console.sign_in_failed' : 'console.locked',
        targetType: 'console_user',
        targetId: userId ?? 'unknown',
        reason:
          lockedUntil === null
            ? 'wrong name or password'
            : `locked until ${lockedUntil.toISOString()}`,
      });
    });
  }

  async createInvitation(tokenHash: string, displayName: string, expiresAt: Date): Promise<void> {
    await this.pool.query(
      `INSERT INTO console_invite (token_hash, display_name, expires_at) VALUES ($1, $2, $3)`,
      [tokenHash, displayName, expiresAt],
    );
  }

  async openInvitation(
    tokenHash: string,
  ): Promise<{ display_name: string; expires_at: Date } | null> {
    const { rows } = await this.pool.query<{ display_name: string; expires_at: Date }>(
      `SELECT display_name, expires_at FROM console_invite
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
      [tokenHash],
    );
    return rows[0] ?? null;
  }

  /** Opens the account an invitation was made for; `taken` when the name is used, `closed` when the invitation is. */
  async acceptInvitation(
    tokenHash: string,
    username: string,
    passwordHash: string,
  ): Promise<{ kind: 'ok'; user: ConsoleMe } | { kind: 'closed' } | { kind: 'taken' }> {
    return this.transaction(async (client) => {
      const invite = await client.query<{ id: string; display_name: string }>(
        `SELECT id, display_name FROM console_invite
          WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE`,
        [tokenHash],
      );
      const row = invite.rows[0];
      if (row === undefined) return { kind: 'closed' };
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO console_user (username, display_name, password_hash) VALUES ($1, $2, $3)
         ON CONFLICT (username) DO NOTHING RETURNING id`,
        [username, row.display_name, passwordHash],
      );
      const id = inserted.rows[0]?.id;
      if (id === undefined) return { kind: 'taken' };
      await client.query(`UPDATE console_invite SET used_at = now(), used_by = $2 WHERE id = $1`, [
        row.id,
        id,
      ]);
      await this.audit(client, {
        actorId: id,
        actorName: username,
        action: 'console.invitation_accepted',
        targetType: 'console_invite',
        targetId: row.id,
        reason: `account opened for ${row.display_name}`,
      });
      return { kind: 'ok', user: { id, username, display_name: row.display_name } };
    });
  }

  // --- Sessions ------------------------------------------------------------

  async createSession(userId: string, tokenHash: string): Promise<void> {
    await this.pool.query(
      `INSERT INTO console_session (token_hash, user_id, expires_at)
       VALUES ($1, $2, now() + make_interval(hours => $3))`,
      [tokenHash, userId, SESSION_IDLE_HOURS],
    );
  }

  /** The person behind a session that is still open, its idle clock restarted. */
  async sessionUser(tokenHash: string): Promise<ConsoleMe | null> {
    const { rows } = await this.pool.query<ConsoleMe>(
      `UPDATE console_session s
          SET last_seen_at = now(), expires_at = now() + make_interval(hours => $2)
         FROM console_user u
        WHERE s.token_hash = $1 AND s.user_id = u.id AND s.revoked_at IS NULL
          AND s.expires_at > now() AND u.disabled_at IS NULL
        RETURNING u.id, u.username, u.display_name`,
      [tokenHash, SESSION_IDLE_HOURS],
    );
    return rows[0] ?? null;
  }

  async revokeSession(tokenHash: string): Promise<void> {
    await this.pool.query(
      `UPDATE console_session SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`,
      [tokenHash],
    );
  }

  // --- Snapshot ------------------------------------------------------------

  async loadSnapshot(snapshot: ConsoleSnapshot): Promise<void> {
    await this.transaction(async (client) => {
      await client.query(
        `INSERT INTO console_snapshot (generated_at, schema, payload) VALUES ($1, $2, $3)`,
        [snapshot.generated_at, snapshot.schema, JSON.stringify(snapshot)],
      );
      // The last thirty are kept; a day's history is enough to compare with.
      await client.query(
        `DELETE FROM console_snapshot WHERE id NOT IN
           (SELECT id FROM console_snapshot ORDER BY generated_at DESC, loaded_at DESC LIMIT 30)`,
      );
    });
  }

  async latestSnapshot(): Promise<{ snapshot: ConsoleSnapshot; loaded_at: Date } | null> {
    const { rows } = await this.pool.query<{ payload: ConsoleSnapshot; loaded_at: Date }>(
      `SELECT payload, loaded_at FROM console_snapshot ORDER BY generated_at DESC, loaded_at DESC LIMIT 1`,
    );
    const row = rows[0];
    return row === undefined ? null : { snapshot: row.payload, loaded_at: row.loaded_at };
  }

  // --- Commands ------------------------------------------------------------

  async queueCommand(request: ConsoleCommandRequest, actor: ConsoleMe): Promise<ConsoleCommand> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<CommandRow>(
        `INSERT INTO console_command (kind, target, payload, requested_by) VALUES ($1, $2, $3, $4)
         RETURNING id, kind, target, payload, status, $5::text AS requested_by, requested_at, finished_at, outcome`,
        [
          request.kind,
          request.target,
          JSON.stringify(request.payload),
          actor.id,
          actor.display_name,
        ],
      );
      const row = rows[0]!;
      await this.audit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: `command.${request.kind.replace('.', '_')}`,
        targetType: request.kind === 'decision.answer' ? 'decision' : 'agent',
        targetId: request.target,
        reason: request.reason,
        next: request.payload,
      });
      return command(row);
    });
  }

  async commands(limit = 100): Promise<ConsoleCommand[]> {
    const { rows } = await this.pool.query<CommandRow>(
      `SELECT c.id, c.kind, c.target, c.payload, c.status, u.display_name AS requested_by,
              c.requested_at, c.finished_at, c.outcome
         FROM console_command c JOIN console_user u ON u.id = c.requested_by
        ORDER BY c.requested_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map(command);
  }

  /** The computer takes every queued command, oldest first. */
  async takeCommands(): Promise<ConsoleCommand[]> {
    const { rows } = await this.pool.query<CommandRow>(
      `UPDATE console_command c SET status = 'taken', taken_at = now()
         FROM console_user u
        WHERE c.status = 'queued' AND u.id = c.requested_by
        RETURNING c.id, c.kind, c.target, c.payload, c.status, u.display_name AS requested_by,
                  c.requested_at, c.finished_at, c.outcome`,
    );
    return rows.map(command).sort((a, b) => a.requested_at.localeCompare(b.requested_at));
  }

  async finishCommand(id: string, status: 'done' | 'failed', outcome: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `UPDATE console_command SET status = $2, outcome = $3, finished_at = now()
        WHERE id = $1 AND status = 'taken'`,
      [id, status, outcome.slice(0, 1000)],
    );
    return (rowCount ?? 0) > 0;
  }

  // --- Board ---------------------------------------------------------------

  async cards(): Promise<ConsoleBoardCard[]> {
    const { rows } = await this.pool.query<CardRow>(
      `SELECT ${CARD_COLUMNS} FROM console_board_card c LEFT JOIN console_user u ON u.id = c.updated_by
        WHERE c.archived_at IS NULL ORDER BY c.column_key, c.position, c.created_at`,
    );
    return rows.map(card);
  }

  /** Whether a card moved from the old board is here already. */
  async cardFromSource(sourceRef: string): Promise<boolean> {
    const { rowCount } = await this.pool.query(
      `SELECT 1 FROM console_board_card WHERE source_ref = $1`,
      [sourceRef],
    );
    return (rowCount ?? 0) > 0;
  }

  async createCard(
    input: ConsoleBoardCardInput,
    actor: ConsoleMe,
    sourceRef?: string,
  ): Promise<ConsoleBoardCard> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO console_board_card
           (title, body, column_key, position, labels, assignee, due_on, source_ref, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
        [
          input.title,
          input.body ?? '',
          input.column,
          input.position ?? 0,
          input.labels ?? [],
          input.assignee ?? null,
          input.due_on ?? null,
          sourceRef ?? null,
          actor.id,
        ],
      );
      const id = rows[0]!.id;
      await this.audit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'board.card_created',
        targetType: 'board_card',
        targetId: id,
        reason: sourceRef === undefined ? 'card added' : `moved from ${sourceRef}`,
        next: input,
      });
      return this.cardById(client, id);
    });
  }

  async updateCard(
    id: string,
    input: ConsoleBoardCardInput,
    actor: ConsoleMe,
  ): Promise<ConsoleBoardCard | null> {
    return this.transaction(async (client) => {
      const before = await client.query<CardRow>(
        `SELECT ${CARD_COLUMNS} FROM console_board_card c LEFT JOIN console_user u ON u.id = c.updated_by
          WHERE c.id = $1 AND c.archived_at IS NULL FOR UPDATE OF c`,
        [id],
      );
      const previous = before.rows[0];
      if (previous === undefined) return null;
      await client.query(
        `UPDATE console_board_card SET
           title = COALESCE($2, title), body = COALESCE($3, body), column_key = COALESCE($4, column_key),
           position = COALESCE($5, position), labels = COALESCE($6, labels),
           assignee = CASE WHEN $7::boolean THEN $8 ELSE assignee END,
           due_on = CASE WHEN $9::boolean THEN $10::date ELSE due_on END,
           updated_by = $11, updated_at = now()
         WHERE id = $1`,
        [
          id,
          input.title ?? null,
          input.body ?? null,
          input.column ?? null,
          input.position ?? null,
          input.labels ?? null,
          input.assignee !== undefined,
          input.assignee ?? null,
          input.due_on !== undefined,
          input.due_on ?? null,
          actor.id,
        ],
      );
      await this.audit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'board.card_changed',
        targetType: 'board_card',
        targetId: id,
        reason: 'card changed',
        previous: card(previous),
        next: input,
      });
      return this.cardById(client, id);
    });
  }

  async archiveCard(id: string, actor: ConsoleMe): Promise<boolean> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<{ title: string }>(
        `UPDATE console_board_card SET archived_at = now(), updated_by = $2, updated_at = now()
          WHERE id = $1 AND archived_at IS NULL RETURNING title`,
        [id, actor.id],
      );
      if (rows[0] === undefined) return false;
      await this.audit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'board.card_archived',
        targetType: 'board_card',
        targetId: id,
        reason: 'card archived',
        previous: { title: rows[0].title },
      });
      return true;
    });
  }

  // --- Audit ---------------------------------------------------------------

  async auditTrail(limit = 200): Promise<ConsoleAuditEntry[]> {
    const { rows } = await this.pool.query<{
      actor_name: string;
      action: string;
      target_type: string;
      target_id: string;
      reason: string;
      created_at: Date;
    }>(
      `SELECT actor_name, action, target_type, target_id, reason, created_at
         FROM console_audit ORDER BY created_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map((r) => ({
      actor: r.actor_name,
      action: r.action,
      target: `${r.target_type}:${r.target_id}`,
      reason: r.reason,
      at: r.created_at.toISOString(),
    }));
  }

  private async audit(client: PoolClient, entry: AuditInput): Promise<void> {
    await client.query(
      `INSERT INTO console_audit (actor_id, actor_name, action, target_type, target_id, reason, previous, next)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        entry.actorId,
        entry.actorName,
        entry.action,
        entry.targetType,
        entry.targetId,
        entry.reason,
        entry.previous === undefined ? null : JSON.stringify(entry.previous),
        entry.next === undefined ? null : JSON.stringify(entry.next),
      ],
    );
  }

  private async cardById(client: PoolClient, id: string): Promise<ConsoleBoardCard> {
    const { rows } = await client.query<CardRow>(
      `SELECT ${CARD_COLUMNS} FROM console_board_card c LEFT JOIN console_user u ON u.id = c.updated_by
        WHERE c.id = $1`,
      [id],
    );
    return card(rows[0]!);
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}
