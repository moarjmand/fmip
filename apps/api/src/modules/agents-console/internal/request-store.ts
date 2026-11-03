import { Inject, Injectable } from '@nestjs/common';
import {
  CONSOLE_REQUEST_STATUSES,
  type ConsoleDecisionChoice,
  type ConsoleMe,
  type ConsoleRequestCounts,
  type ConsoleRequestCreate,
  type ConsoleRequestDetail,
  type ConsoleRequestEdit,
  type ConsoleRequestEvent,
  type ConsoleRequestEventKind,
  type ConsoleRequestList,
  type ConsoleRequestStatus,
} from '@fmip/contracts';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import { writeConsoleAudit } from './console-store';
import {
  OPEN_STATUSES,
  REQUEST_CEILING,
  type RequestMove,
  type ResultStatus,
  nextStatus,
} from './request-rules';

export type RequestOutcome =
  | { kind: 'ok'; request: ConsoleRequestDetail }
  | { kind: 'limited'; retryAfterSeconds: number }
  | { kind: 'missing' }
  | { kind: 'refused'; reason: string };

/** The newest this many are listed; older ones stay in the table. */
export const REQUEST_LIST_LIMIT = 200;

interface RequestRow {
  id: string;
  title: string;
  body: string;
  status: ConsoleRequestStatus;
  priority: ConsoleRequestDetail['priority'];
  created_by: string;
  created_at: Date;
  updated_at: Date;
  result: string | null;
  result_at: Date | null;
  decision_question: string | null;
  decision_asked_at: Date | null;
  decision_choice: ConsoleDecisionChoice | null;
  decision_text: string | null;
  decision_by: string | null;
  decided_at: Date | null;
  execute_requested_at: Date | null;
}

interface EventRow {
  id: string;
  request_id: string;
  kind: ConsoleRequestEventKind;
  actor_id: string | null;
  actor: string | null;
  from_status: ConsoleRequestStatus | null;
  to_status: ConsoleRequestStatus | null;
  note: string | null;
  created_at: Date;
}

const REQUEST_COLUMNS = `r.id, r.title, r.body, r.status, r.priority, cu.display_name AS created_by,
  r.created_at, r.updated_at, r.result, r.result_at, r.decision_question, r.decision_asked_at,
  r.decision_choice, r.decision_text, du.display_name AS decision_by, r.decided_at,
  r.execute_requested_at`;
const REQUEST_FROM = `console_request r
  JOIN console_user cu ON cu.id = r.created_by
  LEFT JOIN console_user du ON du.id = r.decided_by`;

const iso = (d: Date | null): string | null => d?.toISOString() ?? null;

const event = (r: EventRow): ConsoleRequestEvent => ({
  id: r.id,
  kind: r.kind,
  actor_kind: r.actor_id === null ? 'agent' : 'person',
  actor: r.actor_id === null ? null : (r.actor ?? '?'),
  from_status: r.from_status,
  to_status: r.to_status,
  note: r.note,
  at: r.created_at.toISOString(),
});

const detail = (r: RequestRow, events: ConsoleRequestEvent[]): ConsoleRequestDetail => ({
  id: r.id,
  title: r.title,
  body: r.body,
  status: r.status,
  priority: r.priority,
  created_by: r.created_by,
  created_at: r.created_at.toISOString(),
  updated_at: r.updated_at.toISOString(),
  result: r.result,
  result_at: iso(r.result_at),
  decision_question: r.decision_question,
  decision_asked_at: iso(r.decision_asked_at),
  decision_choice: r.decision_choice,
  decision_text: r.decision_text,
  decision_by: r.decision_by,
  decided_at: iso(r.decided_at),
  execute_requested_at: iso(r.execute_requested_at),
  events,
});

/** Who writes: a console person, or Claude through the server's command line. */
type Actor = { kind: 'person'; me: ConsoleMe } | { kind: 'agent' };

const AUDIT_ACTION: Record<ConsoleRequestEventKind, string> = {
  created: 'request.created',
  edited: 'request.edited',
  cancelled: 'request.cancelled',
  reopened: 'request.reopened',
  execute_requested: 'request.execute_requested',
  execute_withdrawn: 'request.execute_withdrawn',
  asked: 'request.asked',
  decided: 'request.decided',
  result: 'request.result',
};

const AUDIT_REASON: Record<ConsoleRequestEventKind, string> = {
  created: 'request added',
  edited: 'request edited',
  cancelled: 'request cancelled',
  reopened: 'request reopened',
  execute_requested: 'marked to run now',
  execute_withdrawn: 'run mark withdrawn',
  asked: "question put on the maintainer's word",
  decided: 'decision recorded',
  result: 'result written',
};

/**
 * Teammate requests (T-1728, D-354). Every change writes one
 * `console_request_event` (the request's timeline) and, in the same
 * transaction, its `console_audit` row with what it was before (rule 10).
 * A person's changes are held to the `console_request` ceiling, counted from
 * that person's own events in the clock hour; Claude's are not.
 */
@Injectable()
export class PostgresRequestStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async list(status: ConsoleRequestStatus | null): Promise<ConsoleRequestList> {
    const { rows } = await this.pool.query<RequestRow>(
      `SELECT ${REQUEST_COLUMNS} FROM ${REQUEST_FROM}
        WHERE $1::text IS NULL OR r.status = $1
        ORDER BY r.created_at DESC, r.id DESC LIMIT $2`,
      [status, REQUEST_LIST_LIMIT],
    );
    const events = await this.eventsOf(
      this.pool,
      rows.map((r) => r.id),
    );
    return {
      requests: rows.map((r) => detail(r, events.get(r.id) ?? [])),
      counts: await this.counts(),
    };
  }

  async counts(): Promise<ConsoleRequestCounts> {
    const { rows } = await this.pool.query<{ status: ConsoleRequestStatus; n: number }>(
      `SELECT status, count(*)::int AS n FROM console_request GROUP BY status`,
    );
    const by = Object.fromEntries(CONSOLE_REQUEST_STATUSES.map((s) => [s, 0])) as Record<
      ConsoleRequestStatus,
      number
    >;
    for (const row of rows) by[row.status] = row.n;
    const all = Object.values(by).reduce((a, b) => a + b, 0);
    return { all, open: OPEN_STATUSES.reduce((a, s) => a + by[s], 0), by_status: by };
  }

  async get(id: string): Promise<ConsoleRequestDetail | null> {
    return this.byId(this.pool, id);
  }

  async create(input: Required<ConsoleRequestCreate>, me: ConsoleMe): Promise<RequestOutcome> {
    return this.transaction(async (client) => {
      const limited = await this.overCeiling(client, me);
      if (limited !== null) return limited;
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO console_request (title, body, priority, created_by) VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [input.title, input.body, input.priority, me.id],
      );
      const id = rows[0]!.id;
      await this.record(client, id, { kind: 'person', me }, 'created', null, 'new', null, {
        next: input,
      });
      return { kind: 'ok', request: (await this.byId(client, id))! };
    });
  }

  async edit(id: string, input: ConsoleRequestEdit, me: ConsoleMe): Promise<RequestOutcome> {
    return this.personMove(id, me, { kind: 'edit' }, async (client, before) => {
      await client.query(
        `UPDATE console_request SET title = COALESCE($2, title), body = COALESCE($3, body),
                priority = COALESCE($4, priority), updated_at = now()
          WHERE id = $1`,
        [id, input.title ?? null, input.body ?? null, input.priority ?? null],
      );
      return {
        kind: 'edited',
        note: null,
        previous: { title: before.title, body: before.body, priority: before.priority },
        next: input,
      };
    });
  }

  async changeStatus(
    id: string,
    action: 'cancel' | 'reopen',
    me: ConsoleMe,
  ): Promise<RequestOutcome> {
    return this.personMove(id, me, { kind: action }, async (client, before, to) => {
      await client.query(
        `UPDATE console_request SET status = $2, execute_requested_at = NULL,
                execute_requested_by = NULL, updated_at = now()
          WHERE id = $1`,
        [id, to],
      );
      return {
        kind: action === 'cancel' ? 'cancelled' : 'reopened',
        note: null,
        previous: { status: before.status },
        next: { status: to },
      };
    });
  }

  /** "Run it now", or its withdrawal; marking one already marked keeps the first time. */
  async setExecute(id: string, on: boolean, me: ConsoleMe): Promise<RequestOutcome> {
    return this.personMove(id, me, { kind: 'execute', on }, async (client, before) => {
      if (on) {
        await client.query(
          `UPDATE console_request SET execute_requested_at = COALESCE(execute_requested_at, now()),
                  execute_requested_by = COALESCE(execute_requested_by, $2), updated_at = now()
            WHERE id = $1`,
          [id, me.id],
        );
      } else {
        await client.query(
          `UPDATE console_request SET execute_requested_at = NULL, execute_requested_by = NULL,
                  updated_at = now()
            WHERE id = $1`,
          [id],
        );
      }
      return {
        kind: on ? 'execute_requested' : 'execute_withdrawn',
        note: null,
        previous: { execute_requested_at: iso(before.execute_requested_at) },
        next: { execute: on },
      };
    });
  }

  /** Any console user answers the open question; the request moves to `decided`. */
  async decide(
    id: string,
    choice: ConsoleDecisionChoice,
    text: string | null,
    me: ConsoleMe,
  ): Promise<RequestOutcome> {
    return this.personMove(id, me, { kind: 'decide' }, async (client, before, to) => {
      await client.query(
        `UPDATE console_request SET status = $2, decision_choice = $3, decision_text = $4,
                decided_by = $5, decided_at = now(), updated_at = now()
          WHERE id = $1`,
        [id, to, choice, text, me.id],
      );
      return {
        kind: 'decided',
        note: text === null ? choice : `${choice}: ${text}`,
        previous: { status: before.status },
        next: { status: to, choice, text },
      };
    });
  }

  /** Claude's result (`request-result`): the box, the status, and the run mark cleared. */
  async agentResult(id: string, status: ResultStatus, text: string): Promise<RequestOutcome> {
    return this.agentMove(id, { kind: 'result', status }, async (client, before, to) => {
      await client.query(
        `UPDATE console_request SET status = $2, result = $3, result_at = now(),
                execute_requested_at = NULL, execute_requested_by = NULL, updated_at = now()
          WHERE id = $1`,
        [id, to, text],
      );
      return {
        kind: 'result',
        note: text,
        previous: { status: before.status, result: before.result },
        next: { status: to, characters: [...text].length },
      };
    });
  }

  /**
   * Claude's question for the teammate (`request-ask`), on the maintainer's
   * word: `waiting_decision`, the question shown, any earlier decision
   * cleared from the request (its text stays in the history).
   */
  async agentAsk(id: string, question: string): Promise<RequestOutcome> {
    return this.agentMove(id, { kind: 'ask' }, async (client, before, to) => {
      await client.query(
        `UPDATE console_request SET status = $2, decision_question = $3, decision_asked_at = now(),
                decision_choice = NULL, decision_text = NULL, decided_by = NULL, decided_at = NULL,
                execute_requested_at = NULL, execute_requested_by = NULL, updated_at = now()
          WHERE id = $1`,
        [id, to, question],
      );
      return {
        kind: 'asked',
        note: question,
        previous: {
          status: before.status,
          question: before.decision_question,
          choice: before.decision_choice,
          text: before.decision_text,
        },
        next: { status: to, characters: [...question].length },
      };
    });
  }

  // --- The parts --------------------------------------------------------------

  private personMove(
    id: string,
    me: ConsoleMe,
    move: RequestMove,
    apply: Apply,
  ): Promise<RequestOutcome> {
    return this.transaction(async (client) => {
      const limited = await this.overCeiling(client, me);
      if (limited !== null) return limited;
      return this.move(client, id, { kind: 'person', me }, move, apply);
    });
  }

  private agentMove(id: string, move: RequestMove, apply: Apply): Promise<RequestOutcome> {
    return this.transaction((client) => this.move(client, id, { kind: 'agent' }, move, apply));
  }

  private async move(
    client: PoolClient,
    id: string,
    actor: Actor,
    move: RequestMove,
    apply: Apply,
  ): Promise<RequestOutcome> {
    const { rows } = await client.query<RawRow>(
      `SELECT * FROM console_request WHERE id = $1 FOR UPDATE`,
      [id],
    );
    const before = rows[0];
    if (before === undefined) return { kind: 'missing' };
    const next = nextStatus(before.status, move);
    if (!next.ok) return { kind: 'refused', reason: next.reason };
    const change = await apply(client, before, next.status);
    await this.record(client, id, actor, change.kind, before.status, next.status, change.note, {
      previous: change.previous,
      next: change.next,
    });
    return { kind: 'ok', request: (await this.byId(client, id))! };
  }

  /** The event and the audit row of one change. */
  private async record(
    client: PoolClient,
    id: string,
    actor: Actor,
    kind: ConsoleRequestEventKind,
    from: ConsoleRequestStatus | null,
    to: ConsoleRequestStatus | null,
    note: string | null,
    values: { previous?: unknown; next?: unknown },
  ): Promise<void> {
    const actorId = actor.kind === 'person' ? actor.me.id : null;
    await client.query(
      `INSERT INTO console_request_event (request_id, actor_id, kind, from_status, to_status, note)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, actorId, kind, from, to, note],
    );
    await writeConsoleAudit(client, {
      actorId,
      actorName: actor.kind === 'person' ? actor.me.username : 'agent',
      action: AUDIT_ACTION[kind],
      targetType: 'console_request',
      targetId: id,
      reason: AUDIT_REASON[kind],
      previous: values.previous,
      next: values.next,
    });
  }

  /**
   * The `console_request` ceiling: the person's events in the current clock
   * hour, with the person's row locked so two writes at once count one after
   * the other; a refusal is counted in `rate_refusal` (T-811). A missing
   * `rate_limit` row means no ceiling.
   */
  private async overCeiling(
    client: PoolClient,
    me: ConsoleMe,
  ): Promise<{ kind: 'limited'; retryAfterSeconds: number } | null> {
    await client.query(`SELECT 1 FROM console_user WHERE id = $1 FOR UPDATE`, [me.id]);
    const { rows } = await client.query<{
      per_hour: number | null;
      used: number;
      retry_after: number;
    }>(
      `SELECT l.per_hour,
              (SELECT count(*) FROM console_request_event
                WHERE actor_id = $1 AND created_at >= date_trunc('hour', now()))::int AS used,
              ceil(extract(epoch FROM date_trunc('hour', now()) + interval '1 hour' - now()))::int
                AS retry_after
         FROM (SELECT 1) AS one LEFT JOIN rate_limit l ON l.action = $2`,
      [me.id, REQUEST_CEILING],
    );
    const row = rows[0];
    if (row === undefined || row.per_hour === null || row.used < row.per_hour) return null;
    await client.query(
      `INSERT INTO rate_refusal (action, day, count) VALUES ($1, $2::date, 1)
       ON CONFLICT (action, day) DO UPDATE SET count = rate_refusal.count + 1`,
      [REQUEST_CEILING, new Date().toISOString().slice(0, 10)],
    );
    return { kind: 'limited', retryAfterSeconds: Math.max(1, row.retry_after) };
  }

  private async byId(db: Pool | PoolClient, id: string): Promise<ConsoleRequestDetail | null> {
    const { rows } = await db.query<RequestRow>(
      `SELECT ${REQUEST_COLUMNS} FROM ${REQUEST_FROM} WHERE r.id = $1`,
      [id],
    );
    const row = rows[0];
    if (row === undefined) return null;
    return detail(row, (await this.eventsOf(db, [id])).get(id) ?? []);
  }

  private async eventsOf(
    db: Pool | PoolClient,
    ids: string[],
  ): Promise<Map<string, ConsoleRequestEvent[]>> {
    const out = new Map<string, ConsoleRequestEvent[]>();
    if (ids.length === 0) return out;
    const { rows } = await db.query<EventRow>(
      `SELECT e.id, e.request_id, e.kind, e.actor_id, u.display_name AS actor, e.from_status,
              e.to_status, e.note, e.created_at
         FROM console_request_event e LEFT JOIN console_user u ON u.id = e.actor_id
        WHERE e.request_id = ANY($1::uuid[])
        ORDER BY e.created_at, e.id`,
      [ids],
    );
    for (const row of rows) {
      const list = out.get(row.request_id) ?? [];
      list.push(event(row));
      out.set(row.request_id, list);
    }
    return out;
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

/** A request's row as the table has it, before the change. */
interface RawRow {
  id: string;
  title: string;
  body: string;
  status: ConsoleRequestStatus;
  priority: string;
  result: string | null;
  decision_question: string | null;
  decision_choice: string | null;
  decision_text: string | null;
  execute_requested_at: Date | null;
}

type Apply = (
  client: PoolClient,
  before: RawRow,
  to: ConsoleRequestStatus,
) => Promise<{
  kind: ConsoleRequestEventKind;
  note: string | null;
  previous: unknown;
  next: unknown;
}>;
