import { Inject, Injectable } from '@nestjs/common';
import type {
  ConsoleAuditEntry,
  ConsoleBoardCard,
  ConsoleBoardCardInput,
  ConsoleBoardColumn,
  ConsoleChatItem,
  ConsoleCommand,
  ConsoleCommandRequest,
  ConsoleConversation,
  ConsoleHeartbeat,
  ConsoleMe,
  ConsoleMessage,
  ConsoleSnapshot,
} from '@fmip/contracts';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import {
  ANSWERING_TIMEOUT_MINUTES,
  CHAT_CONTEXT,
  COMMAND_CEILING,
  CONVERSATION_PAGE,
  FAILURE_MAX,
  MESSAGE_CEILING,
  RUN_CEILING,
  SESSION_IDLE_HOURS,
  SESSION_MAX_DAYS,
  isFindingCommand,
} from './console-rules';

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
  requested_by_username: string;
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
  requested_by_username: r.requested_by_username,
  requested_at: r.requested_at.toISOString(),
  finished_at: r.finished_at?.toISOString() ?? null,
  outcome: r.outcome,
});

/**
 * What queueing a command answers (T-1880): the command, a refusal past one
 * of the two hourly ceilings (which one, for the sentence), or `waiting` when
 * the agent already has a run queued.
 */
export type QueueCommandOutcome =
  | { kind: 'ok'; command: ConsoleCommand }
  | { kind: 'limited'; ceiling: string; retryAfterSeconds: number }
  | { kind: 'waiting' };

/** What a command changes, as the loaded snapshot had it, for the audit row's previous value. */
export type CommandPrevious = Record<string, string | null>;

interface MessageRow {
  id: string;
  agent: string;
  author_id: string | null;
  author: string | null;
  body: string;
  status: ConsoleMessage['status'];
  reply_to: string | null;
  failure: string | null;
  created_at: Date;
}

const MESSAGE_COLUMNS = `m.id, m.agent, m.author_id, u.display_name AS author, m.body, m.status,
  m.reply_to, m.failure, m.created_at`;

const message = (r: MessageRow): ConsoleMessage => ({
  id: r.id,
  agent: r.agent,
  author_kind: r.author_id === null ? 'agent' : 'person',
  author: r.author_id === null ? r.agent : (r.author ?? '?'),
  body: r.body,
  created_at: r.created_at.toISOString(),
  status: r.status,
  reply_to: r.reply_to,
  failure: r.failure,
});

/** A `console_audit` row, inside the change's own transaction (rule 10). */
export async function writeConsoleAudit(client: PoolClient, entry: AuditInput): Promise<void> {
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

/**
 * What the account commands of the server's command line answer (T-1880):
 * the sessions ended; for `disable-user` the queued commands, the unanswered
 * messages and the run marks on teammate requests called off; and whether the
 * account is the console's owner. `already` when there was nothing to change
 * (nothing is written).
 */
export type AccountOutcome =
  | {
      kind: 'ok';
      sessions: number;
      commands: number;
      messages: number;
      runMarks: number;
      owner: boolean;
    }
  | { kind: 'missing' }
  | { kind: 'already' };

const NOTHING_CALLED_OFF = { sessions: 0, commands: 0, messages: 0, runMarks: 0 };

/** The audit's actor for a command run on the server: the operator it names, never an account. */
export const operatorName = (by: string): string => `${by} (server)`;

/** Why a queued message of an account that was then disabled got no answer; the chat shows it. */
export const DISABLED_MESSAGE_FAILURE = 'حساب فرستنده غیرفعال شد؛ این پیام برای عامل فرستاده نشد.';

export type PostMessageOutcome =
  { kind: 'ok'; message: ConsoleMessage } | { kind: 'limited'; retryAfterSeconds: number };

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

  /**
   * An invitation made on the server (`invite`), with its audit row (rule 10,
   * T-1880): who it is for and until when, never the token or its hash.
   */
  async createInvitation(tokenHash: string, displayName: string, expiresAt: Date): Promise<void> {
    await this.transaction(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO console_invite (token_hash, display_name, expires_at) VALUES ($1, $2, $3)
         RETURNING id`,
        [tokenHash, displayName, expiresAt],
      );
      await this.audit(client, {
        actorId: null,
        actorName: 'invite (server)',
        action: 'console.invitation_created',
        targetType: 'console_invite',
        targetId: rows[0]!.id,
        reason: `invitation made for ${displayName}`,
        next: { display_name: displayName, expires_at: expiresAt.toISOString() },
      });
    });
  }

  /**
   * The account's kill switch (T-1880), from the server's command line only:
   * `disabled_at` is set, which refuses the sign-in and every session at once
   * (`sessionUser`), and each open session is ended. What the account had
   * asked of the maintainer's computer and has not been done yet is called
   * off in the same transaction:
   *   - its queued commands (`cancelled`);
   *   - its messages to the agents that have no answer yet, queued or being
   *     answered (`failed`, with the line the chat shows), so one the
   *     computer took is not taken again after `ANSWERING_TIMEOUT_MINUTES`
   *     and a reply that arrives for it is not stored;
   *   - the run marks it put on teammate requests (`execute_requested_by`),
   *     so "run the marked ones" runs nothing this account marked. The
   *     requests themselves stay, with whatever text they have.
   * What it cannot call off: a command the computer has already taken, and an
   * agent run already started on the computer for a message.
   *
   * One audit row: the operator named on the command line, the reason, and
   * what was open before, the unmarked requests listed with when each had
   * been marked. The requests' own history gets no line: its marks are a
   * person's (`console_request_event_actor`), and this is the server's.
   */
  async disableUser(username: string, by: string, reason: string): Promise<AccountOutcome> {
    return this.transaction(async (client) => {
      const user = await this.lockUser(client, username);
      if (user === null) return { kind: 'missing' as const };
      if (user.disabled_at !== null) return { kind: 'already' as const };
      const disabled = await client.query<{ disabled_at: Date }>(
        `UPDATE console_user SET disabled_at = now() WHERE id = $1 RETURNING disabled_at`,
        [user.id],
      );
      const sessions = await this.endSessionsOf(client, user.id);
      const commands = await client.query(
        `UPDATE console_command SET status = 'cancelled' WHERE requested_by = $1 AND status = 'queued'`,
        [user.id],
      );
      const messages = await client.query<{ was: 'queued' | 'answering' }>(
        `UPDATE console_message m SET status = 'failed', failure = $2, answered_at = now()
           FROM (SELECT id, status FROM console_message
                  WHERE author_id = $1 AND status IN ('queued', 'answering') FOR UPDATE) old
          WHERE m.id = old.id
          RETURNING old.status AS was`,
        [user.id, DISABLED_MESSAGE_FAILURE],
      );
      const marks = await client.query<{ id: string; was: Date }>(
        `UPDATE console_request r
            SET execute_requested_at = NULL, execute_requested_by = NULL, updated_at = now()
           FROM (SELECT id, execute_requested_at FROM console_request
                  WHERE execute_requested_by = $1 AND execute_requested_at IS NOT NULL
                  FOR UPDATE) old
          WHERE r.id = old.id
          RETURNING r.id, old.execute_requested_at AS was`,
        [user.id],
      );
      const answering = messages.rows.filter((m) => m.was === 'answering').length;
      const counts = {
        sessions,
        commands: commands.rowCount ?? 0,
        messages: messages.rows.length,
        runMarks: marks.rows.length,
      };
      await this.audit(client, {
        actorId: null,
        actorName: operatorName(by),
        action: 'console.user_disabled',
        targetType: 'console_user',
        targetId: user.id,
        reason,
        previous: {
          disabled_at: null,
          owner: user.owner,
          open_sessions: counts.sessions,
          queued_commands: counts.commands,
          queued_messages: counts.messages - answering,
          answering_messages: answering,
          run_marks: counts.runMarks,
          run_marked_requests: marks.rows
            .map((m) => ({ id: m.id, marked_at: m.was.toISOString() }))
            .sort((x, y) => x.marked_at.localeCompare(y.marked_at) || x.id.localeCompare(y.id)),
        },
        next: {
          disabled_at: disabled.rows[0]!.disabled_at.toISOString(),
          open_sessions: 0,
          queued_commands: 0,
          queued_messages: 0,
          answering_messages: 0,
          run_marks: 0,
        },
      });
      return { kind: 'ok' as const, ...counts, owner: user.owner };
    });
  }

  /**
   * Opens a disabled account again (T-1880). Its ended sessions stay ended:
   * the person signs in anew. Audited with when it had been disabled.
   */
  async enableUser(username: string, by: string, reason: string): Promise<AccountOutcome> {
    return this.transaction(async (client) => {
      const user = await this.lockUser(client, username);
      if (user === null) return { kind: 'missing' as const };
      if (user.disabled_at === null) return { kind: 'already' as const };
      await client.query(`UPDATE console_user SET disabled_at = NULL WHERE id = $1`, [user.id]);
      await this.audit(client, {
        actorId: null,
        actorName: operatorName(by),
        action: 'console.user_enabled',
        targetType: 'console_user',
        targetId: user.id,
        reason,
        previous: { disabled_at: user.disabled_at.toISOString() },
        next: { disabled_at: null },
      });
      return { kind: 'ok' as const, ...NOTHING_CALLED_OFF, owner: user.owner };
    });
  }

  /**
   * Ends every open session of one account (T-1880), which stays enabled: the
   * person signs in again, a copied cookie does not. `already` when none was
   * open, and then nothing is written.
   */
  async endSessions(username: string, by: string, reason: string): Promise<AccountOutcome> {
    return this.transaction(async (client) => {
      const user = await this.lockUser(client, username);
      if (user === null) return { kind: 'missing' as const };
      const sessions = await this.endSessionsOf(client, user.id);
      if (sessions === 0) return { kind: 'already' as const };
      await this.audit(client, {
        actorId: null,
        actorName: operatorName(by),
        action: 'console.sessions_ended',
        targetType: 'console_user',
        targetId: user.id,
        reason,
        previous: { open_sessions: sessions },
        next: { open_sessions: 0 },
      });
      return { kind: 'ok' as const, ...NOTHING_CALLED_OFF, sessions, owner: user.owner };
    });
  }

  /**
   * Makes one enabled account the console's owner (D-427 point 6: the
   * maintainer, who alone changes a social post kind's level; the publisher's
   * key is either person's), taking it from any other in the same transaction
   * (at most one, `console_user_one_owner`), with an audit row naming the server's
   * command as actor and the previous owner. Only the CLI's `set-owner` calls
   * it; no route does (T-1836).
   */
  async setOwner(
    username: string,
    reason: string,
  ): Promise<{ kind: 'ok'; previous: string | null } | { kind: 'missing' } | { kind: 'already' }> {
    return this.transaction(async (client) => {
      const target = await client.query<{ id: string; owner: boolean }>(
        `SELECT id, owner FROM console_user WHERE username = $1 AND disabled_at IS NULL FOR UPDATE`,
        [username],
      );
      const user = target.rows[0];
      if (user === undefined) return { kind: 'missing' as const };
      if (user.owner) return { kind: 'already' as const };
      const before = await client.query<{ username: string }>(
        `UPDATE console_user SET owner = false WHERE owner RETURNING username`,
      );
      await client.query(`UPDATE console_user SET owner = true WHERE id = $1`, [user.id]);
      const previous = before.rows[0]?.username ?? null;
      await this.audit(client, {
        actorId: null,
        actorName: 'set-owner (server)',
        action: 'console.owner_set',
        targetType: 'console_user',
        targetId: user.id,
        reason,
        previous: { owner: previous },
        next: { owner: username },
      });
      return { kind: 'ok' as const, previous };
    });
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

  /**
   * The person behind a session that is still open, its idle clock restarted.
   * A session also ends `SESSION_MAX_DAYS` after it was created, however much
   * it is used (T-1880): `expires_at` never passes that moment, and a session
   * older than it is refused whatever `expires_at` says, so a copied cookie
   * does not live as long as someone keeps using it.
   */
  async sessionUser(tokenHash: string): Promise<ConsoleMe | null> {
    const { rows } = await this.pool.query<ConsoleMe>(
      `UPDATE console_session s
          SET last_seen_at = now(),
              expires_at = LEAST(now() + make_interval(hours => $2),
                                 s.created_at + make_interval(hours => $3))
         FROM console_user u
        WHERE s.token_hash = $1 AND s.user_id = u.id AND s.revoked_at IS NULL
          AND s.expires_at > now() AND s.created_at + make_interval(hours => $3) > now()
          AND u.disabled_at IS NULL
        RETURNING u.id, u.username, u.display_name`,
      // In hours, so a day is 24 of them whatever the database's time zone does.
      [tokenHash, SESSION_IDLE_HOURS, SESSION_MAX_DAYS * 24],
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

  /**
   * The computer's heartbeat (T-1906, D-456): when the newest snapshot
   * arrived, and how many commands and messages still wait for the computer.
   * Counts that cannot be read are `null`, never zero (rule 3).
   */
  async heartbeat(): Promise<ConsoleHeartbeat> {
    const { rows } = await this.pool.query<{ loaded_at: Date }>(
      `SELECT loaded_at FROM console_snapshot ORDER BY generated_at DESC, loaded_at DESC LIMIT 1`,
    );
    const loaded_at = rows[0]?.loaded_at.toISOString() ?? null;
    try {
      const counts = await this.pool.query<{ commands: string; messages: string }>(
        `SELECT (SELECT count(*) FROM console_command WHERE status = 'queued') AS commands,
                (SELECT count(*) FROM console_message WHERE status = 'queued') AS messages`,
      );
      const row = counts.rows[0];
      return {
        loaded_at,
        queued:
          row === undefined
            ? null
            : { commands: Number(row.commands), messages: Number(row.messages) },
      };
    } catch {
      return { loaded_at, queued: null };
    }
  }

  // --- Commands ------------------------------------------------------------

  /**
   * A person's command, queued for the computer and audited, or refused
   * (T-1880): past the `console_command` ceiling (that person's commands in
   * the current clock hour, counted from these rows), past the tighter
   * `console_command_run` ceiling for `agent.run`, or when the same agent
   * already has a run waiting -- the computer starts every queued run in one
   * go, so a second one would run the agent twice. The person's row is locked
   * first, so two posts at once are counted one after the other; a refusal is
   * counted in `rate_refusal` like the API's other ceilings (T-811). A missing
   * `rate_limit` row means no ceiling.
   *
   * A triage command (T-1907) is a command like the others: counted in the
   * same hourly ceiling, and one finding takes one at a time, `waiting` while
   * an earlier one is still queued or taken. Its audit row names the finding
   * and carries `previous`, the status the loaded snapshot showed.
   */
  async queueCommand(
    request: ConsoleCommandRequest,
    actor: ConsoleMe,
    previous?: CommandPrevious,
  ): Promise<QueueCommandOutcome> {
    return this.transaction(async (client) => {
      await client.query(`SELECT 1 FROM console_user WHERE id = $1 FOR UPDATE`, [actor.id]);
      const run = request.kind === 'agent.run';
      const { rows: verdict } = await client.query<{
        per_hour: number | null;
        run_per_hour: number | null;
        used: number;
        runs: number;
        retry_after: number;
      }>(
        `SELECT (SELECT per_hour FROM rate_limit WHERE action = $2) AS per_hour,
                (SELECT per_hour FROM rate_limit WHERE action = $3) AS run_per_hour,
                count(*)::int AS used,
                (count(*) FILTER (WHERE kind = 'agent.run'))::int AS runs,
                ceil(extract(epoch FROM date_trunc('hour', now()) + interval '1 hour' - now()))::int
                  AS retry_after
           FROM console_command
          WHERE requested_by = $1 AND requested_at >= date_trunc('hour', now())`,
        [actor.id, COMMAND_CEILING, RUN_CEILING],
      );
      const counted = verdict[0]!;
      const over =
        run && counted.run_per_hour !== null && counted.runs >= counted.run_per_hour
          ? RUN_CEILING
          : counted.per_hour !== null && counted.used >= counted.per_hour
            ? COMMAND_CEILING
            : null;
      if (over !== null) {
        // The day is the application's, like the report's (RateLimitsService).
        await client.query(
          `INSERT INTO rate_refusal (action, day, count) VALUES ($1, $2::date, 1)
           ON CONFLICT (action, day) DO UPDATE SET count = rate_refusal.count + 1`,
          [over, new Date().toISOString().slice(0, 10)],
        );
        return {
          kind: 'limited',
          ceiling: over,
          retryAfterSeconds: Math.max(1, counted.retry_after),
        };
      }
      if (run) {
        // Under a lock on the agent's name: two people asking at once queue one run.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          `console_command:agent.run:${request.target}`,
        ]);
        const waiting = await client.query(
          `SELECT 1 FROM console_command
            WHERE kind = 'agent.run' AND target = $1 AND status = 'queued' LIMIT 1`,
          [request.target],
        );
        if ((waiting.rowCount ?? 0) > 0) return { kind: 'waiting' };
      }
      const triage = isFindingCommand(request.kind);
      if (triage) {
        // Under a lock on the finding's id: two people triaging at once queue one command.
        await client.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
          `console_command:finding:${request.target}`,
        ]);
        const waiting = await client.query(
          `SELECT 1 FROM console_command
            WHERE kind LIKE 'finding.%' AND target = $1 AND status IN ('queued', 'taken') LIMIT 1`,
          [request.target],
        );
        if ((waiting.rowCount ?? 0) > 0) return { kind: 'waiting' };
      }
      const { rows } = await client.query<CommandRow>(
        `INSERT INTO console_command (kind, target, payload, requested_by) VALUES ($1, $2, $3, $4)
         RETURNING id, kind, target, payload, status, $5::text AS requested_by,
                   $6::text AS requested_by_username, requested_at, finished_at, outcome`,
        [
          request.kind,
          request.target,
          JSON.stringify(request.payload),
          actor.id,
          actor.display_name,
          actor.username,
        ],
      );
      const row = rows[0]!;
      await this.audit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: `command.${request.kind.replace('.', '_')}`,
        targetType: triage ? 'finding' : request.kind === 'decision.answer' ? 'decision' : 'agent',
        targetId: request.target,
        reason: request.reason,
        ...(previous === undefined ? {} : { previous }),
        next: request.payload,
      });
      return { kind: 'ok', command: command(row) };
    });
  }

  async commands(limit = 100): Promise<ConsoleCommand[]> {
    const { rows } = await this.pool.query<CommandRow>(
      `SELECT c.id, c.kind, c.target, c.payload, c.status, u.display_name AS requested_by,
              u.username AS requested_by_username, c.requested_at, c.finished_at, c.outcome
         FROM console_command c JOIN console_user u ON u.id = c.requested_by
        ORDER BY c.requested_at DESC LIMIT $1`,
      [limit],
    );
    return rows.map(command);
  }

  /**
   * The computer takes every queued command, oldest first; never one of a
   * disabled account (T-1880: `disable-user` cancels them, and this holds one
   * queued by a request that was already past its session check).
   */
  /** The triage commands the computer has not reported back (T-1907): queued or taken, oldest first. */
  async openTriage(): Promise<ConsoleCommand[]> {
    const { rows } = await this.pool.query<CommandRow>(
      `SELECT c.id, c.kind, c.target, c.payload, c.status, u.display_name AS requested_by,
              u.username AS requested_by_username, c.requested_at, c.finished_at, c.outcome
         FROM console_command c JOIN console_user u ON u.id = c.requested_by
        WHERE c.kind LIKE 'finding.%' AND c.status IN ('queued', 'taken')
        ORDER BY c.requested_at`,
    );
    return rows.map(command);
  }

  async takeCommands(): Promise<ConsoleCommand[]> {
    const { rows } = await this.pool.query<CommandRow>(
      `UPDATE console_command c SET status = 'taken', taken_at = now()
         FROM console_user u
        WHERE c.status = 'queued' AND u.id = c.requested_by AND u.disabled_at IS NULL
        RETURNING c.id, c.kind, c.target, c.payload, c.status, u.display_name AS requested_by,
                  u.username AS requested_by_username, c.requested_at, c.finished_at, c.outcome`,
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

  // --- Chat with an agent (T-1722, D-350) ----------------------------------

  /**
   * A person's message to an agent, queued for the computer and audited, or
   * refused past the `console_message` ceiling: that person's messages in
   * the current clock hour, counted from these rows. The person's row is
   * locked first, so two of their posts at once are counted one after the
   * other; a refusal is counted in `rate_refusal` like the API's other
   * ceilings (T-811). A missing `rate_limit` row means no ceiling.
   */
  async postMessage(agent: string, body: string, actor: ConsoleMe): Promise<PostMessageOutcome> {
    return this.transaction(async (client) => {
      await client.query(`SELECT 1 FROM console_user WHERE id = $1 FOR UPDATE`, [actor.id]);
      const { rows: verdict } = await client.query<{
        per_hour: number | null;
        used: number;
        retry_after: number;
      }>(
        `SELECT l.per_hour,
                (SELECT count(*) FROM console_message
                  WHERE author_id = $1 AND created_at >= date_trunc('hour', now()))::int AS used,
                ceil(extract(epoch FROM date_trunc('hour', now()) + interval '1 hour' - now()))::int
                  AS retry_after
           FROM (SELECT 1) AS one LEFT JOIN rate_limit l ON l.action = $2`,
        [actor.id, MESSAGE_CEILING],
      );
      const row = verdict[0];
      if (row !== undefined && row.per_hour !== null && row.used >= row.per_hour) {
        // The day is the application's, like the report's (RateLimitsService).
        await client.query(
          `INSERT INTO rate_refusal (action, day, count) VALUES ($1, $2::date, 1)
           ON CONFLICT (action, day) DO UPDATE SET count = rate_refusal.count + 1`,
          [MESSAGE_CEILING, new Date().toISOString().slice(0, 10)],
        );
        return { kind: 'limited', retryAfterSeconds: Math.max(1, row.retry_after) };
      }
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO console_message (agent, author_id, body, status) VALUES ($1, $2, $3, 'queued')
         RETURNING id`,
        [agent, actor.id, body],
      );
      const id = rows[0]!.id;
      await this.audit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'chat.message_posted',
        targetType: 'agent',
        targetId: agent,
        reason: 'message to the agent',
        next: { message_id: id, characters: [...body].length },
      });
      return { kind: 'ok', message: (await this.messagesById(client, [id]))[0]! };
    });
  }

  /** An agent's conversation, a page of it ending before `before` (a message id), oldest first. */
  async conversation(
    agent: string,
    before: string | null = null,
    limit = CONVERSATION_PAGE,
  ): Promise<ConsoleConversation> {
    const { rows } = await this.pool.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS}
         FROM console_message m LEFT JOIN console_user u ON u.id = m.author_id
        WHERE m.agent = $1
          AND ($2::uuid IS NULL OR (m.created_at, m.id) <
               (SELECT b.created_at, b.id FROM console_message b WHERE b.id = $2 AND b.agent = $1))
        ORDER BY m.created_at DESC, m.id DESC
        LIMIT $3`,
      [agent, before, limit + 1],
    );
    return {
      agent,
      messages: rows.slice(0, limit).map(message).reverse(),
      has_older: rows.length > limit,
    };
  }

  /**
   * The computer takes every queued message, oldest first, each with its
   * conversation up to it; a message taken over an hour ago and never
   * answered (the run died) is taken again. Never a disabled account's
   * (T-1880), queued or taken before.
   */
  async takeMessages(): Promise<ConsoleChatItem[]> {
    const { rows } = await this.pool.query<MessageRow>(
      `WITH taken AS (
         UPDATE console_message SET status = 'answering', taken_at = now()
          WHERE author_id IN (SELECT id FROM console_user WHERE disabled_at IS NULL)
            AND (status = 'queued'
                 OR (status = 'answering' AND taken_at < now() - make_interval(mins => $1)))
          RETURNING *
       )
       SELECT ${MESSAGE_COLUMNS}
         FROM taken m LEFT JOIN console_user u ON u.id = m.author_id
        ORDER BY m.created_at, m.id`,
      [ANSWERING_TIMEOUT_MINUTES],
    );
    const items: ConsoleChatItem[] = [];
    for (const row of rows) {
      const context = await this.pool.query<MessageRow>(
        `SELECT ${MESSAGE_COLUMNS}
           FROM console_message m LEFT JOIN console_user u ON u.id = m.author_id
          WHERE m.agent = $1
            AND (m.created_at, m.id) <= (SELECT b.created_at, b.id FROM console_message b WHERE b.id = $2)
          ORDER BY m.created_at DESC, m.id DESC
          LIMIT $3`,
        // The row's own time from the table: a JavaScript Date drops the microseconds.
        [row.agent, row.id, CHAT_CONTEXT],
      );
      items.push({ message: message(row), conversation: context.rows.map(message).reverse() });
    }
    return items;
  }

  /**
   * The computer's answer to a message it took: the agent's reply stored as
   * the agent's message, or why there is none. False when no such message
   * is waiting for an answer.
   */
  async postReply(id: string, status: 'answered' | 'failed', text: string): Promise<boolean> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<{ agent: string }>(
        `SELECT agent FROM console_message
          WHERE id = $1 AND author_id IS NOT NULL AND status = 'answering' FOR UPDATE`,
        [id],
      );
      const waiting = rows[0];
      if (waiting === undefined) return false;
      if (status === 'answered') {
        await client.query(
          `INSERT INTO console_message (agent, author_id, body, reply_to) VALUES ($1, NULL, $2, $3)`,
          [waiting.agent, text, id],
        );
        await client.query(
          `UPDATE console_message SET status = 'answered', answered_at = now() WHERE id = $1`,
          [id],
        );
      } else {
        const why = [...(text.trim() || 'The run did not answer.')];
        await client.query(
          `UPDATE console_message SET status = 'failed', failure = $2, answered_at = now() WHERE id = $1`,
          [
            id,
            why.length > FAILURE_MAX ? `${why.slice(0, FAILURE_MAX - 1).join('')}…` : why.join(''),
          ],
        );
      }
      return true;
    });
  }

  private async messagesById(client: PoolClient, ids: string[]): Promise<ConsoleMessage[]> {
    const { rows } = await client.query<MessageRow>(
      `SELECT ${MESSAGE_COLUMNS}
         FROM console_message m LEFT JOIN console_user u ON u.id = m.author_id
        WHERE m.id = ANY($1::uuid[]) ORDER BY m.created_at, m.id`,
      [ids],
    );
    return rows.map(message);
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

  /** One account by name, locked for the transaction, disabled or not. */
  private async lockUser(
    client: PoolClient,
    username: string,
  ): Promise<{ id: string; disabled_at: Date | null; owner: boolean } | null> {
    const { rows } = await client.query<{ id: string; disabled_at: Date | null; owner: boolean }>(
      `SELECT id, disabled_at, owner FROM console_user WHERE username = $1 FOR UPDATE`,
      [username],
    );
    return rows[0] ?? null;
  }

  /** Ends the account's sessions that were still open; how many. */
  private async endSessionsOf(client: PoolClient, userId: string): Promise<number> {
    const { rowCount } = await client.query(
      `UPDATE console_session SET revoked_at = now()
        WHERE user_id = $1 AND revoked_at IS NULL AND expires_at > now()
          AND created_at + make_interval(hours => $2) > now()`,
      [userId, SESSION_MAX_DAYS * 24],
    );
    return rowCount ?? 0;
  }

  private async audit(client: PoolClient, entry: AuditInput): Promise<void> {
    await writeConsoleAudit(client, entry);
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
