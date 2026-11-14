import { randomUUID } from 'node:crypto';
import type { MatchCentre } from '@fmip/contracts';
// The identity of the link `@/components/ui/link` draws, to name it on the wire;
// its props, prefetch included, are the ones that wrapper set (T-1456).
// eslint-disable-next-line no-restricted-imports
import NextLink from 'next/link';
import { Fragment, type ReactElement, type ReactNode, isValidElement } from 'react';
import { DEFAULT_LOCALE, isLocale, isPseudoLocale } from '@/i18n/locales';
import { type ApiResult, fetchMatchCentre } from '@/lib/api';
import {
  LIVE_FORMAT,
  type LiveAnswer,
  type LivePart,
  type LiveSlot,
  type LiveReload,
  SHARED_FOR_MS,
  WIRE_NODE_PROPS,
  WIRE_TAGS,
  type WireElement,
  type WireIsland,
  type WireNode,
  liveQuery,
  liveSignature,
  slotsReading,
  wireAttrAllowed,
  wireIslandPropAllowed,
} from '@/lib/live-modules';
import { isTimeZone } from '@/lib/scores';
import { matchWords } from '@/lib/words-server';
import { LiveAge, LiveBehind } from '@/components/live-age';
import { Pictured } from '@/components/lite-mode';
import { liveSlot } from '@/components/match-live-slots';

/**
 * The live modules' answer on the server (D-422, amending D-409 point 2): the
 * match centre's moving modules drawn again when the live page's stream says
 * they changed, for the public address `/api/fixtures/:id/live.js`
 * (`liveModulesPath`) that Cloudflare keeps for two seconds, so a goal costs
 * the origin about one answer per locale, zone and parts whatever the
 * audience.
 *
 * Public and read-only: a fixture id, a locale, an IANA zone and the parts,
 * nothing else. No cookie and no header of the reader is read (the API
 * client is given the locale, so it reads no reader header either), so the
 * answer is the same document for everyone and holds no personal data: it
 * is the match's public cards. It never draws from what a client sends: it
 * asks the API for the match itself.
 */

/**
 * This server process, for the page and the answers it draws: a page whose
 * answers come from another process (a deploy, a restart) asks for the page
 * again, which loads the new build when there is one. Kept on `globalThis`
 * so the page's bundle and the route's share it.
 */
export function serverInstance(): string {
  const box = globalThis as { __fmipLiveInstance?: string };
  box.__fmipLiveInstance ??= randomUUID();
  return box.__fmipLiveInstance;
}

/** The client components a card may hold, and their names on the wire. */
const ISLANDS = new Map<unknown, WireIsland>([
  [NextLink, 'link'],
  [Pictured, 'pictured'],
  [LiveAge, 'age'],
  [LiveBehind, 'behind'],
]);

const CLIENT_REFERENCE = Symbol.for('react.client.reference');

/** A client component's props: drawn nodes (`children`, `fallback`) as `{ $n }`; each prop allow-listed. */
function islandProps(island: WireIsland, props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (!wireIslandPropAllowed(island, name, value)) {
      throw new Error(`live modules: ${island} may not carry ${name}`);
    }
    out[name] =
      WIRE_NODE_PROPS.has(name) && typeof value !== 'string'
        ? { $n: toWire(value as ReactNode) }
        : value;
  }
  return out;
}

/** A host element's attributes, each allow-listed (review R2-B2). */
function hostProps(tag: string, props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined) continue;
    if (!wireAttrAllowed(name, value)) {
      throw new Error(`live modules: <${tag}> may not carry ${name}`);
    }
    out[name] = value;
  }
  return out;
}

/**
 * A card drawn once, as data (D-422): every server component in the tree is
 * called now; host elements and the four client components a card holds are
 * written out, each checked against the one allow-list `fromWire` applies
 * (`WIRE_TAGS`, `wireAttrAllowed`, `wireIslandPropAllowed`; review R2-B2), so
 * the server never sends what the page would drop. Anything else is refused
 * loudly, so a new tag, attribute or client component in a card is found by
 * the specs rather than sent. The cards are pure functions of their props --
 * no hooks, no context, no awaiting.
 */
export function toWire(node: ReactNode): WireNode {
  if (node === null || node === undefined || typeof node === 'boolean') return null;
  if (typeof node === 'string' || typeof node === 'number') return node;
  if (typeof node === 'bigint') return String(node);
  if (Array.isArray(node)) return node.map(toWire);
  if (!isValidElement(node)) throw new Error('live modules: a node that is not an element');
  const { type, props, key } = node as ReactElement<Record<string, unknown>>;
  const k = key === null ? {} : { k: key };
  const island = ISLANDS.get(type);
  if (island !== undefined) return { i: island, ...k, p: islandProps(island, props) };
  if (type === Fragment) return toWire(props.children as ReactNode);
  if (typeof type === 'string') {
    if (!WIRE_TAGS.has(type)) throw new Error(`live modules: no <${type}> on the wire`);
    const { children, ...rest } = props;
    const element: WireElement = { t: type, ...k, p: hostProps(type, rest) };
    if (children !== undefined) {
      const drawn = toWire(children as ReactNode);
      element.c = Array.isArray(children) ? (drawn as WireNode[]) : [drawn];
    }
    return element;
  }
  if (typeof type === 'function' && (type as { $$typeof?: symbol }).$$typeof !== CLIENT_REFERENCE) {
    return toWire((type as (p: Record<string, unknown>) => ReactNode)(props));
  }
  const name = (type as { name?: string; $$id?: string }).$$id ?? (type as { name?: string }).name;
  throw new Error(`live modules: no wire for the component ${String(name)}`);
}

interface Shared {
  /** When the read started, on this server's clock. */
  readAt: number;
  read: Promise<ApiResult<MatchCentre>>;
  /** Each card drawn from this read, once, on first ask. */
  drawn: Map<LiveSlot, WireNode>;
  /** Each answer written out from this read, once, by its parts. */
  written: Map<string, string>;
}

const shared = new Map<string, Shared>();

function sharedRead(fixtureId: string, locale: string, timeZone: string, now: number): Shared {
  const key = `${fixtureId} ${locale} ${timeZone}`;
  const current = shared.get(key);
  if (current !== undefined && now - current.readAt < SHARED_FOR_MS) return current;
  // A pseudo-locale reads as the default language, whose words it carries,
  // as the page's own read does (`withReaderLocale`; review m1).
  const readLocale = isPseudoLocale(locale) ? DEFAULT_LOCALE : locale;
  const entry: Shared = {
    readAt: now,
    read: fetchMatchCentre(fixtureId, readLocale),
    drawn: new Map(),
    written: new Map(),
  };
  shared.set(key, entry);
  // Forgotten once it has served its time; a failed read is not kept at all.
  void entry.read.then((result) => {
    const forget = () => {
      if (shared.get(key) === entry) shared.delete(key);
    };
    if (!result.ok) forget();
    else setTimeout(forget, SHARED_FOR_MS);
  });
  return entry;
}

/** A fixture id as the API writes it: lower case, so one match is one key. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The parts a query may name, written in their one order (review R2-B1). */
const PARTS: ReadonlyMap<string, LivePart[]> = new Map([
  ['events', ['events']],
  ['stats', ['stats']],
  ['events,stats', ['events', 'stats']],
]);

/** The parts named in the address; `null` for anything not written in the one order. */
export function partsOf(value: string | null): LivePart[] | null {
  return value === null ? null : (PARTS.get(value) ?? null);
}

/**
 * A zone in its canonical IANA name (review R2-B1): the name `Intl` resolves
 * it to, never an offset (`+03:30`), an alias (`GB`) or another spelling
 * (`europe/london`), each of which `Intl` also accepts and each of which would
 * be another key at the edge. `null` for anything else. The page writes the
 * address with the same name.
 */
export function canonicalZone(timeZone: string): string | null {
  if (!isTimeZone(timeZone)) return null;
  const resolved = new Intl.DateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
  if (resolved === 'UTC') return 'UTC';
  return /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+)+$/.test(resolved) ? resolved : null;
}

const refuse = (what: string) => ({ status: 400 as const, body: `{"error":"${what}"}` });

/**
 * The answer for one fixture and query (review R2-B1): `400` for any query
 * not written exactly as `liveQuery` writes it -- the four names in their
 * order, nothing else, the locale one of ours, the parts one of three, the
 * zone in its canonical name; `409` with a reload signal when `b` is not this
 * server process; `503` when the match cannot be read (the page keeps what
 * it has); else the drawn slots as JSON, written once per read and parts.
 * Only the 200 is kept at the edge.
 */
export async function liveAnswer(
  fixtureId: string,
  search: string,
): Promise<{ status: 200 | 400 | 409 | 503; body: string }> {
  if (!UUID.test(fixtureId)) return refuse('fixture');
  const query = new URLSearchParams(search);
  const instance = query.get('b');
  const locale = query.get('locale');
  const parts = query.get('parts');
  const timeZone = query.get('tz');
  if (instance === null || locale === null || parts === null || timeZone === null) {
    return refuse('query');
  }
  if (search !== `?${liveQuery({ instance, locale, parts: parts.split(','), timeZone })}`) {
    return refuse('query');
  }
  if (!isLocale(locale)) return refuse('locale');
  const asked = partsOf(parts);
  if (asked === null) return refuse('parts');
  if (canonicalZone(timeZone) !== timeZone) return refuse('tz');
  if (!/^[0-9a-f-]{36}$/.test(instance)) return refuse('b');
  if (instance !== serverInstance()) {
    const reload: LiveReload = { v: LIVE_FORMAT, reload: true, instance: serverInstance() };
    return { status: 409, body: JSON.stringify(reload) };
  }
  const entry = sharedRead(fixtureId, locale, timeZone, Date.now());
  const result = await entry.read;
  if (!result.ok) return { status: 503, body: '{"error":"unreachable"}' };
  const key = asked.join(',');
  let body = entry.written.get(key);
  if (body === undefined) {
    const props = { centre: result.data, locale, timeZone, words: matchWords(locale) };
    const modules: LiveAnswer['modules'] = {};
    for (const slot of slotsReading(asked)) {
      let card = entry.drawn.get(slot);
      if (card === undefined) {
        card = toWire(liveSlot(slot, props));
        entry.drawn.set(slot, card);
      }
      modules[slot] = card;
    }
    const answer: LiveAnswer = {
      v: LIVE_FORMAT,
      instance: serverInstance(),
      modules,
      parts: asked,
      drawn: liveSignature(result.data),
      readAt: entry.readAt,
    };
    body = JSON.stringify(answer);
    entry.written.set(key, body);
  }
  return { status: 200, body };
}
