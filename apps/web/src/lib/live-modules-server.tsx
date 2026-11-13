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
  LIVE_PARTS,
  type LiveAnswer,
  type LivePart,
  type LiveSlot,
  SHARED_FOR_MS,
  type WireElement,
  type WireIsland,
  type WireNode,
  isLivePart,
  liveSignature,
  slotsReading,
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

/** A drawn node's props: drawn nodes inside them (a fallback, children) as `{ $n }`. */
function wireProps(props: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(props)) {
    if (value === undefined || typeof value === 'function') continue;
    out[name] =
      isValidElement(value) || (Array.isArray(value) && value.some(isValidElement))
        ? { $n: toWire(value as ReactNode) }
        : value;
  }
  return out;
}

/**
 * A card drawn once, as data (D-422): every server component in the tree is
 * called now, host elements and the four client components a card holds are
 * written out; anything else is refused loudly, so a new client component in
 * a card is found by the specs rather than drawn wrong. The cards are pure
 * functions of their props -- no hooks, no context, no awaiting.
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
  if (island !== undefined) return { i: island, ...k, p: wireProps(props) };
  if (type === Fragment) return toWire(props.children as ReactNode);
  if (typeof type === 'string') {
    const { children, ...rest } = props;
    const element: WireElement = { t: type, ...k, p: wireProps(rest) };
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The parts named in the address, in their fixed order; `null` for anything else. */
export function partsOf(value: string | null): LivePart[] | null {
  if (value === null) return [...LIVE_PARTS];
  const named = value.split(',');
  if (named.length === 0 || named.length > LIVE_PARTS.length) return null;
  if (!named.every(isLivePart) || new Set(named).size !== named.length) return null;
  return LIVE_PARTS.filter((part) => named.includes(part));
}

/**
 * The answer for one fixture, locale, zone and parts: `400` for anything
 * malformed, `503` when the match cannot be read (the page keeps what it
 * has), else the drawn slots as JSON, written once per read and parts.
 */
export async function liveAnswer(
  fixtureId: string,
  locale: string | null,
  timeZone: string | null,
  parts: string | null,
): Promise<{ status: 200 | 400 | 503; body: string }> {
  if (!UUID.test(fixtureId)) return { status: 400, body: '{"error":"fixture"}' };
  if (locale === null || !isLocale(locale)) return { status: 400, body: '{"error":"locale"}' };
  if (timeZone === null || !isTimeZone(timeZone)) return { status: 400, body: '{"error":"tz"}' };
  const asked = partsOf(parts);
  if (asked === null) return { status: 400, body: '{"error":"parts"}' };
  const entry = sharedRead(fixtureId.toLowerCase(), locale, timeZone, Date.now());
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
