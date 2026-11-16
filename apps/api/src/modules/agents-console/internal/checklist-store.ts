/**
 * The pre-launch checklist's Postgres store (T-1840, D-428): sections, items,
 * notes and each item's history, every change a person makes with its
 * `console_audit` row and previous value in the same transaction (rule 10).
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  ConsoleChecklist,
  ConsoleChecklistAssignee,
  ConsoleChecklistEvent,
  ConsoleChecklistItem,
  ConsoleChecklistItemPatch,
  ConsoleChecklistList,
  ConsoleChecklistNote,
  ConsoleChecklistPerson,
  ConsoleChecklistSection,
  ConsoleChecklistStatus,
  ConsoleMe,
} from '@fmip/contracts';
import { CONSOLE_CHECKLIST_AGENTS } from '@fmip/contracts/console';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import { CHECKLIST_CEILING, type ItemState, changesOf } from './checklist-rules';
import { writeConsoleAudit } from './console-store';

export type ChecklistOutcome =
  | { kind: 'ok'; item: ConsoleChecklistItem }
  | { kind: 'missing' }
  | { kind: 'refused'; reason: string }
  | { kind: 'limited'; retryAfterSeconds: number };

type RemoveOutcome = { kind: 'ok' } | Exclude<ChecklistOutcome, { kind: 'ok' }>;

interface ItemRow {
  id: string;
  section_id: string;
  position: number;
  title: string;
  status: ConsoleChecklistStatus;
  assignee_id: string | null;
  assigned_agents: boolean;
  updated_at: Date;
  updated_by: string | null;
}

const ITEM_COLUMNS = `i.id, i.section_id, i.position, i.title, i.status, i.assignee_id,
  i.assigned_agents, i.updated_at, u.display_name AS updated_by`;
const ITEM_FROM = 'console_checklist_item i LEFT JOIN console_user u ON u.id = i.updated_by';

const assigneeOf = (
  row: Pick<ItemRow, 'assignee_id' | 'assigned_agents'>,
): ConsoleChecklistAssignee => (row.assigned_agents ? CONSOLE_CHECKLIST_AGENTS : row.assignee_id);

const stateOf = (row: ItemRow): ItemState => ({
  title: row.title,
  section_id: row.section_id,
  status: row.status,
  assignee: assigneeOf(row),
});

/** The audit row's picture of an item: what a person can change, never bookkeeping. */
const auditOf = (row: ItemRow) => ({ ...stateOf(row), position: row.position });

@Injectable()
export class PostgresChecklistStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Both lists: sections in order, their live items with notes and history, and the people. */
  async checklist(): Promise<ConsoleChecklist> {
    const [sections, items, people] = await Promise.all([
      this.pool.query<{ id: string; list: ConsoleChecklistList; position: number; title: string }>(
        `SELECT id, list, position, title FROM console_checklist_section ORDER BY list, position`,
      ),
      this.pool.query<ItemRow>(
        `SELECT ${ITEM_COLUMNS} FROM ${ITEM_FROM}
          WHERE i.deleted_at IS NULL ORDER BY i.section_id, i.position, i.created_at, i.id`,
      ),
      this.pool.query<ConsoleChecklistPerson>(
        `SELECT id, username, display_name, owner, disabled_at IS NULL AS enabled
           FROM console_user ORDER BY owner DESC, created_at, username`,
      ),
    ]);
    const full = await this.withDetail(this.pool, items.rows);
    const bySection = new Map<string, ConsoleChecklistItem[]>();
    for (const item of full) {
      const list = bySection.get(item.section_id) ?? [];
      list.push(item);
      bySection.set(item.section_id, list);
    }
    const order = (list: ConsoleChecklistList) => (list === 'friends' ? 0 : 1);
    const result: ConsoleChecklistSection[] = sections.rows
      .sort((a, b) => order(a.list) - order(b.list) || a.position - b.position)
      .map((s) => ({ ...s, items: bySection.get(s.id) ?? [] }));
    return { sections: result, people: people.rows };
  }

  /** A new item at the end of its section. */
  async createItem(
    input: { section_id: string; title: string },
    actor: ConsoleMe,
  ): Promise<ChecklistOutcome> {
    return this.transaction(async (client) => {
      const limited = await this.overCeiling(client, actor);
      if (limited !== null) return limited;
      if (!(await this.sectionExists(client, input.section_id))) return { kind: 'missing' };
      const position = await this.nextPosition(client, input.section_id);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO console_checklist_item (section_id, position, title, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $4) RETURNING id`,
        [input.section_id, position, input.title, actor.id],
      );
      const id = rows[0]!.id;
      await this.event(client, id, actor, 'created', null, input.title);
      await writeConsoleAudit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'checklist.item_created',
        targetType: 'checklist_item',
        targetId: id,
        reason: 'item added',
        next: { ...input, position },
      });
      return { kind: 'ok', item: await this.itemById(client, id) };
    });
  }

  /**
   * Changes an item's text, section, status or assignee: one history row per
   * field that really changes, one audit row with the whole before and after.
   * A patch that changes nothing writes nothing.
   */
  async patchItem(
    id: string,
    patch: ConsoleChecklistItemPatch,
    actor: ConsoleMe,
  ): Promise<ChecklistOutcome> {
    return this.transaction(async (client) => {
      const limited = await this.overCeiling(client, actor);
      if (limited !== null) return limited;
      const before = await this.liveForUpdate(client, id);
      if (before === null) return { kind: 'missing' };
      const changes = changesOf(stateOf(before), patch);
      if (changes.length === 0) return { kind: 'ok', item: await this.itemById(client, id) };

      let position = before.position;
      for (const change of changes) {
        if (change.kind === 'sectioned') {
          if (!(await this.sectionExists(client, change.next!)))
            return { kind: 'refused', reason: 'No such section.' };
          position = await this.nextPosition(client, change.next!);
        }
        if (
          change.kind === 'assigned' &&
          change.next !== null &&
          change.next !== CONSOLE_CHECKLIST_AGENTS
        ) {
          const { rowCount } = await client.query(
            `SELECT 1 FROM console_user WHERE id = $1 AND disabled_at IS NULL`,
            [change.next],
          );
          if (rowCount === 0) return { kind: 'refused', reason: 'No such console account.' };
        }
      }
      const after = { ...stateOf(before), ...patch };
      await client.query(
        `UPDATE console_checklist_item
            SET title = $1, section_id = $2, position = $3, status = $4,
                assignee_id = $5, assigned_agents = $6, updated_by = $7
          WHERE id = $8`,
        [
          after.title,
          after.section_id,
          position,
          after.status,
          after.assignee === CONSOLE_CHECKLIST_AGENTS ? null : after.assignee,
          after.assignee === CONSOLE_CHECKLIST_AGENTS,
          actor.id,
          id,
        ],
      );
      for (const change of changes)
        await this.event(client, id, actor, change.kind, change.previous, change.next);
      await writeConsoleAudit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'checklist.item_changed',
        targetType: 'checklist_item',
        targetId: id,
        reason: `changed ${changes.map((c) => c.kind).join(', ')}`,
        previous: auditOf(before),
        next: { ...after, position },
      });
      return { kind: 'ok', item: await this.itemById(client, id) };
    });
  }

  /** Swaps an item with its neighbour in its section; at either end nothing moves. */
  async moveItem(
    id: string,
    direction: 'up' | 'down',
    actor: ConsoleMe,
  ): Promise<ChecklistOutcome> {
    return this.transaction(async (client) => {
      const limited = await this.overCeiling(client, actor);
      if (limited !== null) return limited;
      const before = await this.liveForUpdate(client, id);
      if (before === null) return { kind: 'missing' };
      // Every live item of the section in its order, locked, numbered again
      // from 1 so two items with one position (an old add) still move.
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM console_checklist_item
          WHERE section_id = $1 AND deleted_at IS NULL
          ORDER BY position, created_at, id FOR UPDATE`,
        [before.section_id],
      );
      const ids = rows.map((r) => r.id);
      const at = ids.indexOf(id);
      const to = direction === 'up' ? at - 1 : at + 1;
      if (at < 0 || to < 0 || to >= ids.length)
        return { kind: 'ok', item: await this.itemById(client, id) };
      [ids[at], ids[to]] = [ids[to]!, ids[at]!];
      await client.query(
        `UPDATE console_checklist_item i SET position = o.n
           FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, n)
          WHERE i.id = o.id AND i.position IS DISTINCT FROM o.n::int`,
        [ids],
      );
      await client.query(`UPDATE console_checklist_item SET updated_by = $2 WHERE id = $1`, [
        id,
        actor.id,
      ]);
      await this.event(client, id, actor, 'moved', String(at + 1), String(to + 1));
      await writeConsoleAudit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'checklist.item_moved',
        targetType: 'checklist_item',
        targetId: id,
        reason: `moved ${direction}`,
        previous: { section_id: before.section_id, place: at + 1 },
        next: { section_id: before.section_id, place: to + 1 },
      });
      return { kind: 'ok', item: await this.itemById(client, id) };
    });
  }

  /** Removes an item from the lists; its row, notes and history stay for the audit trail. */
  async removeItem(id: string, reason: string, actor: ConsoleMe): Promise<RemoveOutcome> {
    return this.transaction(async (client) => {
      const limited = await this.overCeiling(client, actor);
      if (limited !== null) return limited;
      const before = await this.liveForUpdate(client, id);
      if (before === null) return { kind: 'missing' };
      await client.query(
        `UPDATE console_checklist_item SET deleted_at = now(), updated_by = $2 WHERE id = $1`,
        [id, actor.id],
      );
      await this.event(client, id, actor, 'removed', before.title, reason);
      await writeConsoleAudit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'checklist.item_removed',
        targetType: 'checklist_item',
        targetId: id,
        reason,
        previous: auditOf(before),
      });
      return { kind: 'ok' };
    });
  }

  /** Adds a note to a live item, with its author and time. */
  async addNote(id: string, body: string, actor: ConsoleMe): Promise<ChecklistOutcome> {
    return this.transaction(async (client) => {
      const limited = await this.overCeiling(client, actor);
      if (limited !== null) return limited;
      const before = await this.liveForUpdate(client, id);
      if (before === null) return { kind: 'missing' };
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO console_checklist_note (item_id, author_id, body) VALUES ($1, $2, $3) RETURNING id`,
        [id, actor.id, body],
      );
      await writeConsoleAudit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'checklist.note_added',
        targetType: 'checklist_item',
        targetId: id,
        reason: 'note added',
        next: { note_id: rows[0]!.id, body },
      });
      return { kind: 'ok', item: await this.itemById(client, id) };
    });
  }

  // --- Reading ---------------------------------------------------------------

  private async itemById(db: Pool | PoolClient, id: string): Promise<ConsoleChecklistItem> {
    const { rows } = await db.query<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM ${ITEM_FROM} WHERE i.id = $1`,
      [id],
    );
    return (await this.withDetail(db, rows))[0]!;
  }

  /** Items with their notes and history, oldest first, each by its author's display name. */
  private async withDetail(
    db: Pool | PoolClient,
    rows: readonly ItemRow[],
  ): Promise<ConsoleChecklistItem[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const [notes, events] = await Promise.all([
      db.query<ConsoleChecklistNote & { item_id: string; created_at: Date }>(
        `SELECT n.id, n.item_id, u.display_name AS author, n.body, n.created_at
           FROM console_checklist_note n JOIN console_user u ON u.id = n.author_id
          WHERE n.item_id = ANY($1::uuid[]) ORDER BY n.created_at, n.id`,
        [ids],
      ),
      db.query<Omit<ConsoleChecklistEvent, 'created_at'> & { item_id: string; created_at: Date }>(
        `SELECT e.item_id, e.kind, u.display_name AS actor, e.previous, e.next, e.created_at
           FROM console_checklist_event e JOIN console_user u ON u.id = e.actor_id
          WHERE e.item_id = ANY($1::uuid[]) ORDER BY e.created_at, e.id`,
        [ids],
      ),
    ]);
    const notesOf = new Map<string, ConsoleChecklistNote[]>();
    for (const { item_id, created_at, ...note } of notes.rows) {
      const list = notesOf.get(item_id) ?? [];
      list.push({ ...note, created_at: created_at.toISOString() });
      notesOf.set(item_id, list);
    }
    const historyOf = new Map<string, ConsoleChecklistEvent[]>();
    for (const { item_id, created_at, ...event } of events.rows) {
      const list = historyOf.get(item_id) ?? [];
      list.push({ ...event, created_at: created_at.toISOString() });
      historyOf.set(item_id, list);
    }
    return rows.map((row) => ({
      id: row.id,
      section_id: row.section_id,
      position: row.position,
      title: row.title,
      status: row.status,
      assignee: assigneeOf(row),
      updated_at: row.updated_at.toISOString(),
      updated_by: row.updated_by,
      notes: notesOf.get(row.id) ?? [],
      history: historyOf.get(row.id) ?? [],
    }));
  }

  // --- Writing ---------------------------------------------------------------

  private async liveForUpdate(client: PoolClient, id: string): Promise<ItemRow | null> {
    const { rows } = await client.query<ItemRow>(
      `SELECT ${ITEM_COLUMNS} FROM ${ITEM_FROM}
        WHERE i.id = $1 AND i.deleted_at IS NULL FOR UPDATE OF i`,
      [id],
    );
    return rows[0] ?? null;
  }

  private async sectionExists(client: PoolClient, id: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `SELECT 1 FROM console_checklist_section WHERE id = $1`,
      [id],
    );
    return (rowCount ?? 0) > 0;
  }

  private async nextPosition(client: PoolClient, sectionId: string): Promise<number> {
    const { rows } = await client.query<{ next: number }>(
      `SELECT coalesce(max(position), 0) + 1 AS next FROM console_checklist_item
        WHERE section_id = $1 AND deleted_at IS NULL`,
      [sectionId],
    );
    return rows[0]!.next;
  }

  private async event(
    client: PoolClient,
    itemId: string,
    actor: ConsoleMe,
    kind: ConsoleChecklistEvent['kind'],
    previous: string | null,
    next: string | null,
  ): Promise<void> {
    await client.query(
      // clock_timestamp(), not now(): the rows of one change keep the order they were written in.
      `INSERT INTO console_checklist_event (item_id, actor_id, kind, previous, next, created_at)
       VALUES ($1, $2, $3, $4, $5, clock_timestamp())`,
      [itemId, actor.id, kind, previous, next],
    );
  }

  /**
   * The `console_checklist` ceiling: the person's changes and notes in the
   * current clock hour, with the person's row locked so two writes at once
   * count one after the other; a refusal is counted in `rate_refusal`
   * (T-811). A missing `rate_limit` row means no ceiling.
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
              ((SELECT count(*) FROM console_checklist_event
                 WHERE actor_id = $1 AND created_at >= date_trunc('hour', now()))
               + (SELECT count(*) FROM console_checklist_note
                   WHERE author_id = $1 AND created_at >= date_trunc('hour', now())))::int AS used,
              ceil(extract(epoch FROM date_trunc('hour', now()) + interval '1 hour' - now()))::int
                AS retry_after
         FROM (SELECT 1) AS one LEFT JOIN rate_limit l ON l.action = $2`,
      [me.id, CHECKLIST_CEILING],
    );
    const row = rows[0];
    if (row === undefined || row.per_hour === null || row.used < row.per_hour) return null;
    await client.query(
      `INSERT INTO rate_refusal (action, day, count) VALUES ($1, $2::date, 1)
       ON CONFLICT (action, day) DO UPDATE SET count = rate_refusal.count + 1`,
      [CHECKLIST_CEILING, new Date().toISOString().slice(0, 10)],
    );
    return { kind: 'limited', retryAfterSeconds: Math.max(1, row.retry_after) };
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
