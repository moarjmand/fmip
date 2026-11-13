// The identity of the link `@/components/ui/link` draws, to name it on the wire;
// its props, prefetch included, are the ones that wrapper set (T-1456).
// eslint-disable-next-line no-restricted-imports
import NextLink from 'next/link';
import { type ComponentType, type ReactNode, createElement } from 'react';
import type { WireIsland, WireNode } from '@/lib/live-modules';
import { LiveAge, LiveBehind } from '@/components/live-age';
import { Pictured } from '@/components/lite-mode';

/**
 * A drawn card back into elements (D-422): what the live modules' address
 * answers (`toWire` on the server) drawn by React as the page's own markup
 * is, the four client components a card holds put back by name. Imported by
 * `LiveMatch` only; every component it names is already in the page's
 * script.
 */
const ISLANDS: Record<WireIsland, ComponentType<never>> = {
  link: NextLink as ComponentType<never>,
  pictured: Pictured as ComponentType<never>,
  age: LiveAge as ComponentType<never>,
  behind: LiveBehind as ComponentType<never>,
};

function propsOf(props: Record<string, unknown> | undefined): Record<string, unknown> {
  if (props === undefined) return {};
  const out: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(props)) {
    out[name] =
      value !== null && typeof value === 'object' && '$n' in value
        ? fromWire((value as { $n: WireNode }).$n)
        : value;
  }
  return out;
}

export function fromWire(node: WireNode): ReactNode {
  if (node === null || typeof node === 'string' || typeof node === 'number') return node;
  if (Array.isArray(node)) return node.map(fromWire);
  const props = propsOf(node.p);
  if (node.k !== undefined) props.key = node.k;
  const type = node.i !== undefined ? ISLANDS[node.i] : node.t;
  if (type === undefined) return null;
  // Spread, so children written as a list stay a list and static ones static.
  return node.c === undefined
    ? createElement(type as string, props)
    : createElement(type as string, props, ...node.c.map(fromWire));
}
