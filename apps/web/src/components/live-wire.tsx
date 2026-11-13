// The identity of the link `@/components/ui/link` draws, to name it on the wire;
// its props, prefetch included, are the ones that wrapper set (T-1456).
// eslint-disable-next-line no-restricted-imports
import NextLink from 'next/link';
import { type ComponentType, type ReactNode, createElement } from 'react';
import {
  WIRE_NODE_PROPS,
  WIRE_TAGS,
  type WireIsland,
  type WireNode,
  isWireIsland,
  wireAttrAllowed,
  wireIslandPropAllowed,
} from '@/lib/live-modules';
import { LiveAge, LiveBehind } from '@/components/live-age';
import { Pictured } from '@/components/lite-mode';

/**
 * A drawn card back into elements (D-422): what the live modules' address
 * answers (`toWire` on the server) drawn by React as the page's own markup
 * is, the four client components a card holds put back by name. Imported by
 * `LiveMatch` only; every component it names is already in the page's
 * script.
 *
 * The answer sits in a cache shared by every reader of a match, so nothing in
 * it is trusted further than the cards need (review R2-B2): a tag outside
 * `WIRE_TAGS` is dropped with its subtree, an attribute outside the allow-list
 * (`wireAttrAllowed`: no `on*`, no `dangerouslySetInnerHTML`, `srcDoc`,
 * `formAction` or `ref`, no style string, `src` only a path on this site) is
 * dropped, a client component is looked up in a `Map` -- never through an
 * object's prototype -- and given only its own allow-listed props (`href`
 * only a path on this site). The server applies the same list before sending.
 */
const ISLANDS: ReadonlyMap<WireIsland, ComponentType<never>> = new Map<
  WireIsland,
  ComponentType<never>
>([
  ['link', NextLink as ComponentType<never>],
  ['pictured', Pictured as ComponentType<never>],
  ['age', LiveAge as ComponentType<never>],
  ['behind', LiveBehind as ComponentType<never>],
]);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** A drawn subtree written into a prop: `{ $n: … }` and nothing else. */
const nodeOf = (value: unknown): WireNode | undefined =>
  isRecord(value) && Object.keys(value).length === 1 && Object.hasOwn(value, '$n')
    ? (value.$n as WireNode)
    : undefined;

function islandProps(island: WireIsland, props: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isRecord(props)) return out;
  for (const [name, value] of Object.entries(props)) {
    if (!wireIslandPropAllowed(island, name, value)) continue;
    if (WIRE_NODE_PROPS.has(name)) {
      const node = nodeOf(value);
      if (node !== undefined) out[name] = fromWire(node);
      else if (typeof value === 'string') out[name] = value;
      continue;
    }
    out[name] = value;
  }
  return out;
}

function hostProps(props: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!isRecord(props)) return out;
  for (const [name, value] of Object.entries(props)) {
    if (wireAttrAllowed(name, value)) out[name] = value;
  }
  return out;
}

export function fromWire(node: WireNode): ReactNode {
  if (node === null || typeof node === 'string' || typeof node === 'number') return node;
  if (Array.isArray(node)) return node.map(fromWire);
  if (!isRecord(node)) return null;
  const key = typeof node.k === 'string' ? { key: node.k } : {};
  const children = Array.isArray(node.c) ? node.c.map(fromWire) : undefined;
  let type: ComponentType<never> | string;
  let props: Record<string, unknown>;
  if (node.i !== undefined) {
    if (!isWireIsland(node.i)) return null;
    const island = ISLANDS.get(node.i);
    if (island === undefined) return null;
    type = island;
    props = islandProps(node.i, node.p);
    // A link only with an address on this site; without one, nothing.
    if (node.i === 'link' && props.href === undefined) return null;
  } else if (typeof node.t === 'string' && WIRE_TAGS.has(node.t)) {
    type = node.t;
    props = hostProps(node.p);
  } else {
    return null;
  }
  // Spread, so children written as a list stay a list and static ones static.
  return children === undefined
    ? createElement(type as string, { ...props, ...key })
    : createElement(type as string, { ...props, ...key }, ...children);
}
