import type { MatchCentre } from '@fmip/contracts';
import type { MatchSlot, MatchSlots } from '@/components/match-centre-view';

/**
 * When the match centre's server-drawn modules are drawn again in play
 * (T-1810, D-409). Pure: the clock and the dice are the caller's, so every
 * rule here is unit-tested and the client component only feeds it readings.
 *
 * The stream sends a snapshot on every write (debounced 300 ms): once a
 * minute for the clock and the score, every three minutes for the
 * statistics (D-382), and on every event. The server modules do not show the
 * clock, so a snapshot that moved only the clock asks for nothing. An event
 * is drawn within a few seconds; a statistics-only change within fifteen,
 * which the three-minute cadence makes invisible; each with a random delay,
 * so a thousand readers of one match do not all ask in the same second.
 * Never two calls in flight: a change that arrives meanwhile is one more
 * call when the first settles.
 */

/** What the server modules are drawn from, without the clock. */
export interface LiveSignature {
  /** The events as recorded, the periods, and the extra-time and shoot-out scores. */
  events: string;
  /** When the statistics, player statistics, expected goals and line-up were last written. */
  stats: string;
}

export type LivePart = keyof LiveSignature;

/** What moved between two snapshots, as far as the server modules are concerned. */
export type LiveChange = 'event' | 'stats';

/**
 * The signature of a snapshot. The minute, the score and the status are not
 * in it: the band draws the first two at once from the snapshot, and a status
 * change draws the whole page again (D-409 point 3).
 */
export function liveSignature(centre: MatchCentre): LiveSignature {
  const f = centre.fixture;
  return {
    events: JSON.stringify([
      centre.timeline.coverage,
      centre.timeline.data,
      f.periods,
      f.scores.extra_time,
      f.scores.penalties,
    ]),
    stats: [
      centre.statistics,
      centre.player_statistics,
      centre.player_expected_goals,
      centre.lineups,
    ]
      .map((module) => `${module.coverage}@${module.last_updated_at ?? ''}`)
      .join('|'),
  };
}

/**
 * What changed between what the modules on screen were drawn from and the
 * newest snapshot, among the parts those modules read: an event before a
 * statistics change, since it is drawn sooner. `null`: nothing to draw.
 */
export function liveChange(
  drawn: LiveSignature,
  latest: LiveSignature,
  parts: readonly LivePart[],
): LiveChange | null {
  if (parts.includes('events') && drawn.events !== latest.events) return 'event';
  if (parts.includes('stats') && drawn.stats !== latest.stats) return 'stats';
  return null;
}

/**
 * How long one read of a match and its drawn cards answer every reader of it
 * in one locale and zone (the live modules' address, review M1): a goal sends
 * about a thousand readers there within three seconds, and they share about
 * two reads and one drawing of each card instead of a thousand. Short
 * enough that a change written meanwhile is drawn by the next call: an
 * answer's signature says what it holds, and the page asks again while it
 * is behind the stream.
 */
export const SHARED_FOR_MS = 2_000;

/** One value per part of the signature. */
export type PerPart<T> = Record<LivePart, T>;

export function both<T>(value: T): PerPart<T> {
  return { events: value, stats: value };
}

/** Every part, in a fixed order. */
export const LIVE_PARTS: readonly LivePart[] = ['events', 'stats'];

export function isLivePart(value: unknown): value is LivePart {
  return value === 'events' || value === 'stats';
}

/**
 * Every part, among those the drawn modules read, whose drawn signature
 * differs from the newest snapshot's: what one call asks the server for, so a
 * statistics tick does not send the key events again (review m2).
 */
export function changedParts(
  drawn: LiveSignature,
  latest: LiveSignature,
  parts: readonly LivePart[],
): LivePart[] {
  return LIVE_PARTS.filter((part) => parts.includes(part) && drawn[part] !== latest[part]);
}

/**
 * What the modules on screen are now drawn from, after a call drew `parts`
 * from data whose signature is `server` (review B2): only those parts move,
 * and to the signature of the data the server actually read -- which may be
 * older than the snapshot that asked, when the read had started before the
 * change was written. The other parts keep what they were drawn from.
 */
export function markDrawn(
  drawn: LiveSignature,
  server: LiveSignature,
  parts: readonly LivePart[],
): LiveSignature {
  return {
    events: parts.includes('events') ? server.events : drawn.events,
    stats: parts.includes('stats') ? server.stats : drawn.stats,
  };
}

/** The longest random wait before an event is drawn. */
export const EVENT_WINDOW_MS = 3_000;
/** The longest random wait before a statistics-only change is drawn. */
export const STATS_WINDOW_MS = 15_000;
/**
 * In lite mode (T-1387) a statistics-only change waits for the next event, or
 * this long: a reader on a metered phone is not sent every three-minute tick.
 */
export const LITE_STATS_WAIT_MS = 6 * 60_000;
/** A change not drawn after this long means the modules may be behind. */
export const BEHIND_AFTER_MS = 60_000;

/**
 * Why a call is planned: a change seen in a snapshot, or the stream opening
 * again after a break (when a deploy has also replaced the server function,
 * which only a call finds out).
 */
export type RefreshReason = LiveChange | 'reopen';

/** The refresh's state: when the next call is due, and whether one is in flight. */
export interface RefreshPlan {
  /** When the next call is due, ms since the epoch; `null` when none is. */
  due: number | null;
  inFlight: boolean;
  /** A call came due while one was in flight: one more as soon as it settles. */
  trailing: boolean;
}

export const NO_REFRESH: RefreshPlan = { due: null, inFlight: false, trailing: false };

/**
 * When a call for this reason goes: an event within `EVENT_WINDOW_MS`, a
 * statistics change or a reopened stream within `STATS_WINDOW_MS` (a
 * reopen after a deploy is every reader at once), in lite mode a
 * statistics change after `LITE_STATS_WAIT_MS`. A call already due sooner
 * stays as it is, so a later change never delays an earlier one, and an
 * event brings a held statistics change forward with it. `random` is in
 * [0, 1).
 */
export function planRefresh(
  plan: RefreshPlan,
  reason: RefreshReason,
  { now, random, lite }: { now: number; random: number; lite: boolean },
): RefreshPlan {
  const at =
    lite && reason === 'stats'
      ? now + LITE_STATS_WAIT_MS
      : now + Math.floor(random * (reason === 'event' ? EVENT_WINDOW_MS : STATS_WINDOW_MS));
  return { ...plan, due: plan.due === null ? at : Math.min(plan.due, at) };
}

/** How many calls in a row may come back still behind before only the stream asks again. */
export const MAX_FOLLOW_UPS = 3;

/**
 * An answer came back drawn from data older than the snapshot that asked
 * (review B2): ask again once the shared read it joined has expired
 * (`SHARED_FOR_MS`), within the event window after it.
 */
export function planFollowUp(
  plan: RefreshPlan,
  { now, random }: { now: number; random: number },
): RefreshPlan {
  const at = now + SHARED_FOR_MS + Math.floor(random * EVENT_WINDOW_MS);
  return { ...plan, due: plan.due === null ? at : Math.min(plan.due, at) };
}

/**
 * The due time has come: call now, or -- with one in flight -- once it
 * settles (the trailing call). Nothing before the due time.
 */
export function refreshDue(plan: RefreshPlan, now: number): { plan: RefreshPlan; call: boolean } {
  if (plan.due === null || now < plan.due) return { plan, call: false };
  if (plan.inFlight) return { plan: { ...plan, due: null, trailing: true }, call: false };
  return { plan: { due: null, inFlight: false, trailing: false }, call: true };
}

/** A call starts. */
export function refreshStarted(plan: RefreshPlan): RefreshPlan {
  return { ...plan, inFlight: true };
}

/**
 * A call settled, drawn or failed: the trailing call goes at once (its wait
 * has passed); a due time still ahead stays for its timer.
 */
export function refreshSettled(plan: RefreshPlan): { plan: RefreshPlan; call: boolean } {
  if (plan.trailing)
    return { plan: { due: plan.due, inFlight: false, trailing: false }, call: true };
  return { plan: { ...plan, inFlight: false }, call: false };
}

/**
 * Whether the server modules may be behind (D-409 point 4): a change they
 * read was seen more than `BEHIND_AFTER_MS` ago and is still not drawn -- a
 * call failed, or is very late. `waitingSince` is when that change was first
 * seen; `null` when the modules show the newest snapshot.
 */
export function modulesBehind(waitingSince: number | null, now: number): boolean {
  return waitingSince !== null && now - waitingSince > BEHIND_AFTER_MS;
}

/**
 * The slots the live modules' address draws again (T-1811..T-1814), each with the
 * parts of the signature it reads: the line-ups read the events too (each
 * player's goals, cards and substitutions so far, D-399).
 */
export const LIVE_SLOTS = {
  keyEvents: ['events'],
  matchStats: ['stats'],
  matchLineups: ['events', 'stats'],
  topRated: ['stats'],
} as const satisfies Partial<Record<MatchSlot, readonly LivePart[]>>;

export type LiveSlot = keyof typeof LIVE_SLOTS;

/** The live slots: what `liveSlots` draws, and what a call may draw again. */
export type LiveModules = Partial<Pick<MatchSlots, LiveSlot>>;

/** The live slots that read any of these parts: what a call for them draws. */
export function slotsReading(parts: readonly LivePart[]): LiveSlot[] {
  return (Object.entries(LIVE_SLOTS) as [LiveSlot, readonly LivePart[]][])
    .filter(([, read]) => read.some((part) => parts.includes(part)))
    .map(([slot]) => slot);
}

/**
 * A drawn card as data (D-422): text, a host element (`t`, its props `p`, its
 * children `c`, its key `k`) or one of the few client components a card holds
 * (`i`: the link, the lite-mode picture, the live age and "may be behind"),
 * whose props may hold drawn nodes (`{ $n: … }`). What the live modules'
 * address answers, so a cache in front of it can hand the same bytes to every
 * reader; the page turns it back into elements (`fromWire`).
 */
export type WireNode = string | number | null | WireNode[] | WireElement;
export interface WireElement {
  t?: string;
  i?: WireIsland;
  k?: string;
  p?: Record<string, unknown>;
  c?: WireNode[];
}
export type WireIsland = 'link' | 'pictured' | 'age' | 'behind';

/** The answer's shape; a page that meets another asks for the page again. */
export const LIVE_FORMAT = 1;

/**
 * What the live modules' address answers (D-422; review B2): the slots it
 * drew, as data, the parts they read, the signature of the data they were
 * drawn from, when the server read it (its own clock, only ever compared with
 * itself), and which server process drew it.
 */
export interface LiveAnswer {
  v: number;
  instance: string;
  modules: Partial<Record<LiveSlot, WireNode>>;
  parts: LivePart[];
  drawn: LiveSignature;
  readAt: number;
}

/**
 * The answer when the page's server process (`b`) is not this one (review
 * R2-B1): no cards, `409`, `no-store`; the page asks for a render of itself,
 * which loads the new build after a deploy.
 */
export interface LiveReload {
  v: number;
  reload: true;
  instance: string;
}

/**
 * The live modules' address (D-422): public and the same for every reader of
 * a match in one locale and zone asking for the same parts, so Cloudflare
 * keeps one copy for `SHARED_FOR_MS`. It ends in `.js` because Cloudflare
 * keeps a response by its path's extension unless a dashboard rule says
 * otherwise (T-1461); the answer is JSON (`nosniff`). The query is written in
 * one order, so one answer has one key; `b` is the page's server process, so
 * a page drawn before a deploy asks a key of its own.
 */
export function liveModulesPath(
  fixtureId: string,
  {
    instance,
    locale,
    parts,
    timeZone,
  }: {
    instance: string;
    locale: string;
    parts: readonly LivePart[];
    timeZone: string;
  },
): string {
  return `/api/fixtures/${fixtureId}/live.js?${liveQuery({ instance, locale, parts, timeZone })}`;
}

/**
 * The address's query in its one written form: `b`, `locale`, `parts`, `tz`
 * in that order, encoded as `URLSearchParams` encodes them. The route answers
 * only a query written exactly so (review R2-B1): any other order, encoding,
 * duplicate or extra name would be another key at the edge for the same
 * answer.
 */
export function liveQuery({
  instance,
  locale,
  parts,
  timeZone,
}: {
  instance: string;
  locale: string;
  parts: readonly string[];
  timeZone: string;
}): string {
  return new URLSearchParams({
    b: instance,
    locale,
    parts: LIVE_PARTS.filter((part) => parts.includes(part)).join(','),
    tz: timeZone,
  }).toString();
}

// ------------------------------------------------------- what a card may hold

/**
 * The host elements the live cards draw (review R2-B2): `toWire` refuses to
 * send any other, `fromWire` drops any other with its subtree.
 */
export const WIRE_TAGS: ReadonlySet<string> = new Set([
  'b',
  'bdi',
  'caption',
  'circle',
  'dd',
  'details',
  'div',
  'dl',
  'dt',
  'g',
  'h2',
  'h3',
  'h4',
  'img',
  'li',
  'line',
  'ol',
  'p',
  'path',
  'rect',
  'section',
  'span',
  'summary',
  'svg',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'time',
  'tr',
  'ul',
]);

/** The attributes a card's host element may carry; `data-*` and `aria-*` besides. */
const WIRE_ATTRS: ReadonlySet<string> = new Set([
  'alt',
  'className',
  'colSpan',
  'cx',
  'cy',
  'd',
  'dateTime',
  'decoding',
  'dir',
  'fill',
  'focusable',
  'height',
  'lang',
  'loading',
  'r',
  'role',
  'rowSpan',
  'rx',
  'scope',
  'src',
  'stroke',
  'strokeLinecap',
  'strokeLinejoin',
  'strokeWidth',
  'style',
  'tabIndex',
  'title',
  'viewBox',
  'width',
  'x',
  'x1',
  'x2',
  'xmlns',
  'y',
  'y1',
  'y2',
]);

/** The inline style properties a card sets: a share of a bar, a mark's place on the axis. */
const WIRE_STYLE: ReadonlySet<string> = new Set(['inlineSize', 'insetInlineStart']);

/** An address on this site: a path from the root, never another origin (`//`, `/\`). */
export function isLocalPath(value: unknown): boolean {
  return (
    typeof value === 'string' &&
    value.startsWith('/') &&
    !value.startsWith('//') &&
    !value.startsWith('/\\') &&
    ![...value].some((c) => c.charCodeAt(0) <= 0x20 || c === '\\')
  );
}

const isPrimitive = (value: unknown): boolean =>
  typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean';

/** A length or a share: `12.5%`, `40px`, `3`. */
const STYLE_VALUE = /^-?\d+(\.\d+)?(%|px|rem|em)?$/;

/** Whether a host element of the wire may carry this attribute with this value. */
export function wireAttrAllowed(name: string, value: unknown): boolean {
  if (/^on/i.test(name)) return false;
  if (name === 'style') {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
    return Object.entries(value).every(
      ([key, v]) => WIRE_STYLE.has(key) && (typeof v === 'number' || STYLE_VALUE.test(String(v))),
    );
  }
  if (name === 'src') return isLocalPath(value);
  if (name.startsWith('data-') || name.startsWith('aria-')) return isPrimitive(value);
  return WIRE_ATTRS.has(name) && isPrimitive(value);
}

/** A resolved message (`Message`): plain text fields only, as `FreshnessStamp` reads them. */
function isMessages(value: unknown): boolean {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  return Object.values(value).every(
    (message) =>
      message !== null &&
      typeof message === 'object' &&
      !Array.isArray(message) &&
      Object.values(message).every((field) => isPrimitive(field) || field === null),
  );
}

/** Each client component's props, and what each may hold; `nodes` are drawn subtrees. */
const ISLAND_PROPS: ReadonlyMap<
  WireIsland,
  ReadonlyMap<string, (value: unknown) => boolean>
> = new Map([
  [
    'link',
    new Map<string, (value: unknown) => boolean>([
      ['href', isLocalPath],
      ['className', (v) => typeof v === 'string'],
      ['prefetch', (v) => typeof v === 'boolean'],
      ['title', (v) => typeof v === 'string'],
      ['children', () => true],
    ]),
  ],
  [
    'pictured',
    new Map<string, (value: unknown) => boolean>([
      ['children', () => true],
      ['fallback', () => true],
    ]),
  ],
  [
    'age',
    new Map<string, (value: unknown) => boolean>([
      ['checkedAt', (v) => typeof v === 'string' || typeof v === 'number'],
      ['staleAfterMs', (v) => typeof v === 'number'],
      ['locale', (v) => typeof v === 'string'],
      ['words', isMessages],
      ['testId', (v) => typeof v === 'string'],
      ['className', (v) => typeof v === 'string'],
      ['followsModules', isLivePart],
    ]),
  ],
  [
    'behind',
    new Map<string, (value: unknown) => boolean>([
      ['part', isLivePart],
      ['locale', (v) => typeof v === 'string'],
      ['words', isMessages],
      ['testId', (v) => typeof v === 'string'],
      ['className', (v) => typeof v === 'string'],
    ]),
  ],
]);

/** The props of a client component that may hold drawn nodes. */
export const WIRE_NODE_PROPS: ReadonlySet<string> = new Set(['children', 'fallback']);

export function isWireIsland(value: unknown): value is WireIsland {
  return typeof value === 'string' && ISLAND_PROPS.has(value as WireIsland);
}

/**
 * Whether a client component of the wire may carry this prop with this value
 * (drawn nodes in `children` and `fallback` are checked as nodes).
 */
export function wireIslandPropAllowed(island: WireIsland, name: string, value: unknown): boolean {
  const check = ISLAND_PROPS.get(island)?.get(name);
  if (check === undefined) return false;
  if (WIRE_NODE_PROPS.has(name)) return true;
  return check(value);
}

/**
 * The parts of the signature the server's live modules on this page read:
 * none when the page drew none of them, and then no call is ever made. The
 * page draws them in every state (`liveSlots`); before kick-off nothing they
 * read moves until the line-ups come, and kick-off itself is a status change.
 */
export function liveParts(slots: MatchSlots): LivePart[] {
  const parts = new Set<LivePart>();
  for (const [slot, read] of Object.entries(LIVE_SLOTS) as [
    keyof typeof LIVE_SLOTS,
    readonly LivePart[],
  ][]) {
    if ((slots[slot] ?? null) !== null) for (const part of read) parts.add(part);
  }
  return [...parts];
}

/** How long the page waits before asking for the match a second time. */
export const RETRY_PAUSE_MS = 250;

/**
 * One retry of a read that could not reach the API or met a server error,
 * before the page says the match is unreachable (finding arc-2026-11-13-01):
 * a render of the match page -- a status change's or a panel event's refresh
 * among them -- that draws that notice puts it in place of the live view,
 * which closes its stream until a reload. A 404 or another answer is final.
 */
export async function retryUnreachable<T extends { ok: boolean; status: number }>(
  read: () => Promise<T>,
  pauseMs = RETRY_PAUSE_MS,
): Promise<T> {
  const first = await read();
  if (first.ok || (first.status !== 0 && first.status < 500)) return first;
  await new Promise((resolve) => setTimeout(resolve, pauseMs));
  return read();
}
