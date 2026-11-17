import type {
  ConsoleCanvasBlock,
  ConsoleCanvasCardPatch,
  ConsoleCanvasEventKind,
  ConsoleCanvasField,
  ConsoleCanvasKey,
  ConsoleCanvasTag,
} from '@fmip/contracts';
import {
  CONSOLE_CANVAS_BLOCKS,
  CONSOLE_CANVAS_DEFAULT_KEY,
  CONSOLE_CANVAS_FIELDS,
  CONSOLE_CANVAS_KEYS,
  CONSOLE_CANVAS_NOTE_MAX,
  CONSOLE_CANVAS_SOURCE_MAX,
  CONSOLE_CANVAS_TAGS,
  CONSOLE_CANVAS_TEXT_MAX,
} from '@fmip/contracts/console';

/**
 * The business model canvas's pure part (T-1856, D-441): which canvas a
 * route names (T-1872, D-448); what a person may
 * write -- a new card, a change, a move up or down -- with its lengths; where
 * a new card goes in its block; and which changes a patch really makes, as
 * the history records them. Nothing here touches the database.
 */

export const CANVAS_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** The `rate_limit` row of every canvas write (D-103). */
export const CANVAS_CEILING = 'console_canvas';

export type Checked<T> = { ok: true; value: T } | { ok: false; reason: string };

/** The card as a person can change it: everything but its place and bookkeeping. */
export interface CardState {
  block: ConsoleCanvasBlock;
  tag: ConsoleCanvasTag;
  text_fa: string;
  text_en: string;
  note_fa: string;
  note_en: string;
  source: string;
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const isBlock = (value: unknown): value is ConsoleCanvasBlock =>
  (CONSOLE_CANVAS_BLOCKS as readonly unknown[]).includes(value);
const isTag = (value: unknown): value is ConsoleCanvasTag =>
  (CONSOLE_CANVAS_TAGS as readonly unknown[]).includes(value);

const MAX: Record<ConsoleCanvasField, number> = {
  text_fa: CONSOLE_CANVAS_TEXT_MAX,
  text_en: CONSOLE_CANVAS_TEXT_MAX,
  note_fa: CONSOLE_CANVAS_NOTE_MAX,
  note_en: CONSOLE_CANVAS_NOTE_MAX,
  source: CONSOLE_CANVAS_SOURCE_MAX,
};
const NAME: Record<ConsoleCanvasField, string> = {
  text_fa: "A card's Persian text",
  text_en: "A card's English text",
  note_fa: "A card's Persian note",
  note_en: "A card's English note",
  source: "A card's source",
};

/** A text field trimmed, never rewritten inside; `null` or nothing is empty. */
function checkField(field: ConsoleCanvasField, value: unknown): Checked<string> {
  if (value === null) return { ok: true, value: '' };
  if (typeof value !== 'string') return { ok: false, reason: `${field} is text.` };
  const trimmed = value.trim();
  if (trimmed.length > MAX[field])
    return { ok: false, reason: `${NAME[field]} is at most ${MAX[field]} characters.` };
  return { ok: true, value: trimmed };
}

const KEY_REASON = `canvas is one of ${CONSOLE_CANVAS_KEYS.join(', ')}.`;

/**
 * The canvas a route names by `?canvas=` (T-1872): none, or an empty one, is
 * Claude's, so every link from before the second canvas still opens it; a
 * key named twice, or one that is no canvas, is refused.
 */
export function checkCanvasKey(value: unknown): Checked<ConsoleCanvasKey> {
  if (value === undefined || value === '') return { ok: true, value: CONSOLE_CANVAS_DEFAULT_KEY };
  if ((CONSOLE_CANVAS_KEYS as readonly unknown[]).includes(value))
    return { ok: true, value: value as ConsoleCanvasKey };
  return { ok: false, reason: KEY_REASON };
}

const BLOCK_REASON = `block is one of ${CONSOLE_CANVAS_BLOCKS.join(', ')}.`;
const TAG_REASON = `tag is one of ${CONSOLE_CANVAS_TAGS.join(', ')}.`;
export const NEEDS_TEXT = 'A card needs its text in Persian or English.';

/** Whether a card would still say something in at least one language. */
export const hasText = (card: Pick<CardState, 'text_fa' | 'text_en'>): boolean =>
  card.text_fa.trim() !== '' || card.text_en.trim() !== '';

/** A new card: its block, a text in at least one language; the tag is an assumption unless said. */
export function checkNewCard(body: unknown): Checked<CardState> {
  if (!isObject(body)) return { ok: false, reason: 'A card is an object.' };
  if (!isBlock(body.block)) return { ok: false, reason: BLOCK_REASON };
  if (body.tag !== undefined && !isTag(body.tag)) return { ok: false, reason: TAG_REASON };
  const card: CardState = {
    block: body.block,
    tag: (body.tag as ConsoleCanvasTag | undefined) ?? 'assumption',
    text_fa: '',
    text_en: '',
    note_fa: '',
    note_en: '',
    source: '',
  };
  for (const field of CONSOLE_CANVAS_FIELDS) {
    if (body[field] === undefined) continue;
    const checked = checkField(field, body[field]);
    if (!checked.ok) return checked;
    card[field] = checked.value;
  }
  if (!hasText(card)) return { ok: false, reason: NEEDS_TEXT };
  return { ok: true, value: card };
}

/**
 * A change to a card: any of its block, tag, texts, notes and source, at
 * least one. A text may be emptied; whether the card still says something in
 * one language is `hasText` on the result, which needs the card as stored.
 */
export function checkCardPatch(body: unknown): Checked<ConsoleCanvasCardPatch> {
  if (!isObject(body)) return { ok: false, reason: 'A change is an object.' };
  const patch: ConsoleCanvasCardPatch = {};
  if (body.block !== undefined) {
    if (!isBlock(body.block)) return { ok: false, reason: BLOCK_REASON };
    patch.block = body.block;
  }
  if (body.tag !== undefined) {
    if (!isTag(body.tag)) return { ok: false, reason: TAG_REASON };
    patch.tag = body.tag;
  }
  for (const field of CONSOLE_CANVAS_FIELDS) {
    if (body[field] === undefined) continue;
    const checked = checkField(field, body[field]);
    if (!checked.ok) return checked;
    patch[field] = checked.value;
  }
  if (Object.keys(patch).length === 0) return { ok: false, reason: 'Nothing to change.' };
  return { ok: true, value: patch };
}

/** A move one place up or down inside the card's block. */
export function checkMove(body: unknown): Checked<'up' | 'down'> {
  if (!isObject(body) || (body.direction !== 'up' && body.direction !== 'down'))
    return { ok: false, reason: 'direction is up or down.' };
  return { ok: true, value: body.direction };
}

/** Where a new card, or one moved in from another block, goes: after every live card there. */
export const nextPosition = (positions: readonly number[]): number =>
  positions.reduce((max, p) => Math.max(max, p), 0) + 1;

/**
 * A block's live cards, in order, after `id` swaps with its neighbour; `null`
 * when it is already at that end (nothing moves) or not in the block.
 */
export function reordered(
  ids: readonly string[],
  id: string,
  direction: 'up' | 'down',
): string[] | null {
  const at = ids.indexOf(id);
  const to = direction === 'up' ? at - 1 : at + 1;
  if (at < 0 || to < 0 || to >= ids.length) return null;
  const next = [...ids];
  [next[at], next[to]] = [next[to]!, next[at]!];
  return next;
}

export interface CardChange {
  kind: Extract<ConsoleCanvasEventKind, 'edited' | 'tagged' | 'moved'>;
  field: ConsoleCanvasField | null;
  previous: string;
  next: string;
}

/**
 * What a patch really changes, one history row per field: each text that
 * differs (`edited`, with its field), the tag (`tagged`), the block
 * (`moved`, block to block). A value sent unchanged is no change.
 */
export function changesOf(before: CardState, patch: ConsoleCanvasCardPatch): CardChange[] {
  const changes: CardChange[] = [];
  if (patch.block !== undefined && patch.block !== before.block)
    changes.push({ kind: 'moved', field: null, previous: before.block, next: patch.block });
  if (patch.tag !== undefined && patch.tag !== before.tag)
    changes.push({ kind: 'tagged', field: null, previous: before.tag, next: patch.tag });
  for (const field of CONSOLE_CANVAS_FIELDS) {
    const value = patch[field];
    if (value !== undefined && value !== before[field])
      changes.push({ kind: 'edited', field, previous: before[field], next: value });
  }
  return changes;
}

/** The audit row's reason for a change: the fields it touched, as `changed block, text_en`. */
export const changedReason = (changes: readonly CardChange[]): string =>
  `changed ${changes.map((c) => c.field ?? (c.kind === 'moved' ? 'block' : 'tag')).join(', ')}`;
