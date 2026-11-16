/**
 * The business model canvas's Postgres store (T-1856, D-441): cards and the
 * canvas's history, every change a person makes with its event row(s) and
 * its `console_audit` row carrying the whole card before and after, in the
 * same transaction (rule 10). Nothing deletes a row: removal is
 * `deleted_at`, and the bin restores.
 */
import { Inject, Injectable } from '@nestjs/common';
import type {
  ConsoleCanvas,
  ConsoleCanvasBlock,
  ConsoleCanvasCard,
  ConsoleCanvasCardPatch,
  ConsoleCanvasEvent,
  ConsoleCanvasField,
  ConsoleCanvasPerson,
  ConsoleCanvasTag,
  ConsoleMe,
} from '@fmip/contracts';
import { CONSOLE_CANVAS_BLOCKS, CONSOLE_CANVAS_HISTORY_SIZE } from '@fmip/contracts/console';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import {
  CANVAS_CEILING,
  type CardState,
  NEEDS_TEXT,
  changedReason,
  changesOf,
  hasText,
  nextPosition,
  reordered,
} from './canvas-rules';
import { writeConsoleAudit } from './console-store';

export type CanvasOutcome =
  | { kind: 'ok'; card: ConsoleCanvasCard }
  | { kind: 'missing' }
  | { kind: 'invalid'; reason: string }
  | { kind: 'refused'; reason: string }
  | { kind: 'limited'; retryAfterSeconds: number };

interface CardRow {
  id: string;
  block: ConsoleCanvasBlock;
  position: number;
  tag: ConsoleCanvasTag;
  text_fa: string;
  text_en: string;
  note_fa: string;
  note_en: string;
  source: string;
  created_at: Date;
  deleted_at: Date | null;
  removed_by: string | null;
  last_actor: string | null;
  last_at: Date | null;
}

/** A card with who removed it and its newest event's actor and time (`console_canvas_event_card`). */
const CARD_SELECT = `
  SELECT c.id, c.block, c.position, c.tag, c.text_fa, c.text_en, c.note_fa, c.note_en, c.source,
         c.created_at, c.deleted_at, d.display_name AS removed_by,
         last.actor AS last_actor, last.created_at AS last_at
    FROM console_canvas_card c
    LEFT JOIN console_user d ON d.id = c.deleted_by
    LEFT JOIN LATERAL (
      SELECT u.display_name AS actor, e.created_at
        FROM console_canvas_event e JOIN console_user u ON u.id = e.actor_id
       WHERE e.card_id = c.id
       ORDER BY e.created_at DESC, e.id DESC LIMIT 1
    ) last ON true`;

/** The nine blocks in fill order, for `array_position`. */
const BLOCK_ORDER = `ARRAY[${CONSOLE_CANVAS_BLOCKS.map((b) => `'${b}'`).join(', ')}]::text[]`;

const cardOf = (row: CardRow): ConsoleCanvasCard => ({
  id: row.id,
  block: row.block,
  position: row.position,
  tag: row.tag,
  text_fa: row.text_fa,
  text_en: row.text_en,
  note_fa: row.note_fa,
  note_en: row.note_en,
  source: row.source,
  created_at: row.created_at.toISOString(),
  last_change:
    row.last_actor === null || row.last_at === null
      ? null
      : { actor: row.last_actor, at: row.last_at.toISOString() },
  removed_at: row.deleted_at === null ? null : row.deleted_at.toISOString(),
  removed_by: row.removed_by,
});

const stateOf = (row: CardRow): CardState => ({
  block: row.block,
  tag: row.tag,
  text_fa: row.text_fa,
  text_en: row.text_en,
  note_fa: row.note_fa,
  note_en: row.note_en,
  source: row.source,
});

/** The audit row's picture of a card: all a person can change, its place, and whether it is removed. */
const auditOf = (state: CardState, position: number, removed: boolean) => ({
  ...state,
  position,
  removed,
});

@Injectable()
export class PostgresCanvasStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The live cards in block order, the bin, the newest changes and the people. */
  async canvas(): Promise<ConsoleCanvas> {
    const [live, removed, history, people] = await Promise.all([
      this.pool.query<CardRow>(
        `${CARD_SELECT}
          WHERE c.deleted_at IS NULL
          ORDER BY array_position(${BLOCK_ORDER}, c.block), c.position, c.created_at, c.id`,
      ),
      this.pool.query<CardRow>(
        `${CARD_SELECT} WHERE c.deleted_at IS NOT NULL ORDER BY c.deleted_at DESC, c.id`,
      ),
      this.pool.query<Omit<ConsoleCanvasEvent, 'created_at'> & { created_at: Date }>(
        `SELECT e.id, e.card_id, e.kind, e.field, u.display_name AS actor, e.previous, e.next,
                e.created_at, c.text_fa AS card_text_fa, c.text_en AS card_text_en
           FROM console_canvas_event e
           JOIN console_user u ON u.id = e.actor_id
           JOIN console_canvas_card c ON c.id = e.card_id
          ORDER BY e.created_at DESC, e.id DESC
          LIMIT $1`,
        [CONSOLE_CANVAS_HISTORY_SIZE],
      ),
      this.pool.query<ConsoleCanvasPerson>(
        `SELECT id, username, display_name, owner
           FROM console_user WHERE disabled_at IS NULL ORDER BY owner DESC, created_at, username`,
      ),
    ]);
    return {
      cards: live.rows.map(cardOf),
      removed: removed.rows.map(cardOf),
      history: history.rows.map((e) => ({ ...e, created_at: e.created_at.toISOString() })),
      people: people.rows,
    };
  }

  /** A new card, last in its block. */
  async createCard(input: CardState, actor: ConsoleMe): Promise<CanvasOutcome> {
    return this.transaction(async (client) => {
      const limited = await this.overCeiling(client, actor);
      if (limited !== null) return limited;
      const position = await this.nextIn(client, input.block);
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO console_canvas_card
           (block, position, tag, text_fa, text_en, note_fa, note_en, source, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $9) RETURNING id`,
        [
          input.block,
          position,
          input.tag,
          input.text_fa,
          input.text_en,
          input.note_fa,
          input.note_en,
          input.source,
          actor.id,
        ],
      );
      const id = rows[0]!.id;
      await this.event(client, id, actor, 'created', null, null, input.text_fa || input.text_en);
      await writeConsoleAudit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'canvas.card_created',
        targetType: 'canvas_card',
        targetId: id,
        reason: 'card added',
        next: auditOf(input, position, false),
      });
      return { kind: 'ok', card: await this.cardById(client, id) };
    });
  }

  /**
   * Changes a card's block, tag, texts, notes or source: one event row per
   * field that really changes, one audit row with the whole card before and
   * after. A new block puts the card last there. A patch that changes
   * nothing writes nothing; one that would leave no text is refused.
   */
  async patchCard(
    id: string,
    patch: ConsoleCanvasCardPatch,
    actor: ConsoleMe,
  ): Promise<CanvasOutcome> {
    return this.transaction(async (client) => {
      const limited = await this.overCeiling(client, actor);
      if (limited !== null) return limited;
      const before = await this.liveForUpdate(client, id);
      if (before === null) return { kind: 'missing' };
      const changes = changesOf(stateOf(before), patch);
      if (changes.length === 0) return { kind: 'ok', card: cardOf(before) };
      const after: CardState = { ...stateOf(before), ...patch };
      if (!hasText(after)) return { kind: 'invalid', reason: NEEDS_TEXT };
      const position =
        after.block === before.block ? before.position : await this.nextIn(client, after.block);
      await client.query(
        `UPDATE console_canvas_card
            SET block = $2, position = $3, tag = $4, text_fa = $5, text_en = $6,
                note_fa = $7, note_en = $8, source = $9, updated_by = $10
          WHERE id = $1`,
        [
          id,
          after.block,
          position,
          after.tag,
          after.text_fa,
          after.text_en,
          after.note_fa,
          after.note_en,
          after.source,
          actor.id,
        ],
      );
      for (const change of changes)
        await this.event(
          client,
          id,
          actor,
          change.kind,
          change.field,
          change.previous,
          change.next,
        );
      await writeConsoleAudit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'canvas.card_changed',
        targetType: 'canvas_card',
        targetId: id,
        reason: changedReason(changes),
        previous: auditOf(stateOf(before), before.position, false),
        next: auditOf(after, position, false),
      });
      return { kind: 'ok', card: await this.cardById(client, id) };
    });
  }

  /** Swaps a card with its neighbour in its block; at either end nothing moves and nothing is written. */
  async moveCard(id: string, direction: 'up' | 'down', actor: ConsoleMe): Promise<CanvasOutcome> {
    return this.transaction(async (client) => {
      const limited = await this.overCeiling(client, actor);
      if (limited !== null) return limited;
      const before = await this.liveForUpdate(client, id);
      if (before === null) return { kind: 'missing' };
      // Every live card of the block in its order, locked, numbered again
      // from 1 so two cards with one place (a restore) still move.
      const { rows } = await client.query<{ id: string }>(
        `SELECT id FROM console_canvas_card
          WHERE block = $1 AND deleted_at IS NULL
          ORDER BY position, created_at, id FOR UPDATE`,
        [before.block],
      );
      const ids = rows.map((r) => r.id);
      const order = reordered(ids, id, direction);
      if (order === null) return { kind: 'ok', card: cardOf(before) };
      const from = ids.indexOf(id) + 1;
      const to = order.indexOf(id) + 1;
      await client.query(
        `UPDATE console_canvas_card c SET position = o.n
           FROM unnest($1::uuid[]) WITH ORDINALITY AS o(id, n)
          WHERE c.id = o.id AND c.position IS DISTINCT FROM o.n::int`,
        [order],
      );
      await client.query(`UPDATE console_canvas_card SET updated_by = $2 WHERE id = $1`, [
        id,
        actor.id,
      ]);
      await this.event(client, id, actor, 'moved', null, String(from), String(to));
      await writeConsoleAudit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'canvas.card_moved',
        targetType: 'canvas_card',
        targetId: id,
        reason: `moved ${direction}`,
        previous: auditOf(stateOf(before), from, false),
        next: auditOf(stateOf(before), to, false),
      });
      return { kind: 'ok', card: await this.cardById(client, id) };
    });
  }

  /** Takes a card off the canvas into the bin; its row, place and history stay. */
  async removeCard(id: string, actor: ConsoleMe): Promise<CanvasOutcome> {
    return this.transaction(async (client) => {
      const limited = await this.overCeiling(client, actor);
      if (limited !== null) return limited;
      const before = await this.liveForUpdate(client, id);
      if (before === null) return { kind: 'missing' };
      await client.query(
        `UPDATE console_canvas_card
            SET deleted_at = now(), deleted_by = $2, updated_by = $2 WHERE id = $1`,
        [id, actor.id],
      );
      await this.event(client, id, actor, 'removed', null, null, null);
      await writeConsoleAudit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'canvas.card_removed',
        targetType: 'canvas_card',
        targetId: id,
        reason: 'card removed',
        previous: auditOf(stateOf(before), before.position, false),
        next: auditOf(stateOf(before), before.position, true),
      });
      return { kind: 'ok', card: await this.cardById(client, id) };
    });
  }

  /**
   * Brings a removed card back to its place in its block (the cards from
   * that place on move one down), so an undo puts it where it was.
   */
  async restoreCard(id: string, actor: ConsoleMe): Promise<CanvasOutcome> {
    return this.transaction(async (client) => {
      const limited = await this.overCeiling(client, actor);
      if (limited !== null) return limited;
      const { rows } = await client.query<CardRow>(
        `${CARD_SELECT} WHERE c.id = $1 FOR UPDATE OF c`,
        [id],
      );
      const before = rows[0];
      if (before === undefined) return { kind: 'missing' };
      if (before.deleted_at === null)
        return { kind: 'refused', reason: 'That card is on the canvas, not in the bin.' };
      await client.query(
        `UPDATE console_canvas_card SET position = position + 1
          WHERE block = $1 AND deleted_at IS NULL AND position >= $2`,
        [before.block, before.position],
      );
      await client.query(
        `UPDATE console_canvas_card
            SET deleted_at = NULL, deleted_by = NULL, updated_by = $2 WHERE id = $1`,
        [id, actor.id],
      );
      await this.event(client, id, actor, 'restored', null, null, null);
      await writeConsoleAudit(client, {
        actorId: actor.id,
        actorName: actor.username,
        action: 'canvas.card_restored',
        targetType: 'canvas_card',
        targetId: id,
        reason: 'card restored',
        previous: auditOf(stateOf(before), before.position, true),
        next: auditOf(stateOf(before), before.position, false),
      });
      return { kind: 'ok', card: await this.cardById(client, id) };
    });
  }

  // --- Reading and writing -------------------------------------------------

  private async cardById(client: PoolClient, id: string): Promise<ConsoleCanvasCard> {
    const { rows } = await client.query<CardRow>(`${CARD_SELECT} WHERE c.id = $1`, [id]);
    return cardOf(rows[0]!);
  }

  private async liveForUpdate(client: PoolClient, id: string): Promise<CardRow | null> {
    const { rows } = await client.query<CardRow>(
      `${CARD_SELECT} WHERE c.id = $1 AND c.deleted_at IS NULL FOR UPDATE OF c`,
      [id],
    );
    return rows[0] ?? null;
  }

  private async nextIn(client: PoolClient, block: ConsoleCanvasBlock): Promise<number> {
    const { rows } = await client.query<{ position: number }>(
      `SELECT position FROM console_canvas_card WHERE block = $1 AND deleted_at IS NULL`,
      [block],
    );
    return nextPosition(rows.map((r) => r.position));
  }

  private async event(
    client: PoolClient,
    cardId: string,
    actor: ConsoleMe,
    kind: ConsoleCanvasEvent['kind'],
    field: ConsoleCanvasField | null,
    previous: string | null,
    next: string | null,
  ): Promise<void> {
    await client.query(
      // clock_timestamp(), not now(): the rows of one change keep the order they were written in.
      `INSERT INTO console_canvas_event (card_id, actor_id, kind, field, previous, next, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, clock_timestamp())`,
      [cardId, actor.id, kind, field, previous, next],
    );
  }

  /**
   * The `console_canvas` ceiling: the person's changes in the current clock
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
              (SELECT count(*) FROM console_canvas_event
                WHERE actor_id = $1 AND created_at >= date_trunc('hour', now()))::int AS used,
              ceil(extract(epoch FROM date_trunc('hour', now()) + interval '1 hour' - now()))::int
                AS retry_after
         FROM (SELECT 1) AS one LEFT JOIN rate_limit l ON l.action = $2`,
      [me.id, CANVAS_CEILING],
    );
    const row = rows[0];
    if (row === undefined || row.per_hour === null || row.used < row.per_hour) return null;
    await client.query(
      `INSERT INTO rate_refusal (action, day, count) VALUES ($1, $2::date, 1)
       ON CONFLICT (action, day) DO UPDATE SET count = rate_refusal.count + 1`,
      [CANVAS_CEILING, new Date().toISOString().slice(0, 10)],
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
