/**
 * The agents console's business model canvas (T-1856, D-441): nine fixed
 * blocks, each with its cards in order; every card in Persian and English,
 * with a tag, a note in each language and its source; soft removal with a
 * bin, and the canvas's history. Runtime values live on the console's own
 * entry point (`@fmip/contracts/console`); the barrel exports the types only.
 */

/**
 * The canvases (T-1872, D-448): the one Claude filled (`claude`, the seed of
 * D-441) and the one the teammate fills himself (`teammate`, empty at first).
 * Every route takes `?canvas=`; without it a route is Claude's, as before.
 */
export const CONSOLE_CANVAS_KEYS = ['claude', 'teammate'] as const;
/** The canvas a route without `?canvas=` reads and writes: the one old links name. */
export const CONSOLE_CANVAS_DEFAULT_KEY = 'claude';

/**
 * The nine blocks, in the order a canvas is filled (and the order the API
 * lists cards in): segments, value, channels, relationships, revenue,
 * resources, activities, partners, costs.
 */
export const CONSOLE_CANVAS_BLOCKS = [
  'customer_segments',
  'value_propositions',
  'channels',
  'customer_relationships',
  'revenue_streams',
  'key_resources',
  'key_activities',
  'key_partners',
  'cost_structure',
] as const;
/** What we know about a card: tested, a hypothesis, a risk, an open question. */
export const CONSOLE_CANVAS_TAGS = ['validated', 'assumption', 'risk', 'question'] as const;
/** The card's fields a person writes, besides its block and tag. */
export const CONSOLE_CANVAS_FIELDS = [
  'text_fa',
  'text_en',
  'note_fa',
  'note_en',
  'source',
] as const;
export const CONSOLE_CANVAS_TEXT_MAX = 500;
export const CONSOLE_CANVAS_NOTE_MAX = 1000;
export const CONSOLE_CANVAS_SOURCE_MAX = 300;
/** How many of the canvas's newest changes `GET /console/canvas` sends. */
export const CONSOLE_CANVAS_HISTORY_SIZE = 100;

export type ConsoleCanvasKey = (typeof CONSOLE_CANVAS_KEYS)[number];
export type ConsoleCanvasBlock = (typeof CONSOLE_CANVAS_BLOCKS)[number];
export type ConsoleCanvasTag = (typeof CONSOLE_CANVAS_TAGS)[number];
export type ConsoleCanvasField = (typeof CONSOLE_CANVAS_FIELDS)[number];
export type ConsoleCanvasEventKind =
  'created' | 'edited' | 'tagged' | 'moved' | 'removed' | 'restored';

/** Who changed a card last and when; `null` on a card nobody has changed since the first fill. */
export interface ConsoleCanvasLastChange {
  actor: string;
  at: string;
}

export interface ConsoleCanvasCard {
  id: string;
  /** The canvas it is on (T-1872). */
  canvas: ConsoleCanvasKey;
  block: ConsoleCanvasBlock;
  /** Its order inside the block. */
  position: number;
  tag: ConsoleCanvasTag;
  /** Either text may be empty, never both. */
  text_fa: string;
  text_en: string;
  note_fa: string;
  note_en: string;
  source: string;
  created_at: string;
  last_change: ConsoleCanvasLastChange | null;
  /** When and by whom it was removed; `null` on a live card. */
  removed_at: string | null;
  removed_by: string | null;
}

/**
 * One change to a card. `previous` and `next` are the values as stored: a
 * text for `edited` (with its `field`), a tag for `tagged`, a block for a
 * move to another block, a place (a number in words, `'3'`) for a move up
 * or down inside one; `null` is none. The card's own texts as they now
 * stand say which card it was.
 */
export interface ConsoleCanvasEvent {
  id: string;
  card_id: string;
  kind: ConsoleCanvasEventKind;
  field: ConsoleCanvasField | null;
  actor: string;
  previous: string | null;
  next: string | null;
  created_at: string;
  card_text_fa: string;
  card_text_en: string;
}

/** A console account, as the canvas names it. */
export interface ConsoleCanvasPerson {
  id: string;
  username: string;
  display_name: string;
  /** The maintainer (`console_user.owner`). */
  owner: boolean;
}

/**
 * `GET /console/canvas?canvas=`: one canvas's live cards in block order, its
 * bin, its newest changes, and the people.
 */
export interface ConsoleCanvas {
  /** The canvas read (T-1872). */
  canvas: ConsoleCanvasKey;
  cards: ConsoleCanvasCard[];
  /** Removed cards, the newest removal first. */
  removed: ConsoleCanvasCard[];
  /** The newest changes, newest first (at most `CONSOLE_CANVAS_HISTORY_SIZE`). */
  history: ConsoleCanvasEvent[];
  people: ConsoleCanvasPerson[];
}

/** `POST /console/canvas/cards`: a block and at least one text; the rest may be left out. */
export interface ConsoleCanvasCardInput {
  block: ConsoleCanvasBlock;
  tag?: ConsoleCanvasTag;
  text_fa?: string;
  text_en?: string;
  note_fa?: string;
  note_en?: string;
  source?: string;
}

/** `PATCH /console/canvas/cards/:id`: any of these, at least one; a new block puts the card last there. */
export interface ConsoleCanvasCardPatch {
  block?: ConsoleCanvasBlock;
  tag?: ConsoleCanvasTag;
  text_fa?: string;
  text_en?: string;
  note_fa?: string;
  note_en?: string;
  source?: string;
}
