import type { MatchCentre } from '@fmip/contracts';
import { Fragment, type ReactElement, type ReactNode, cloneElement, isValidElement } from 'react';
import { LIVE_SLOTS, type LiveSlot } from '@/lib/live-modules';
import type { MatchWords } from '@/lib/words-server';
import { KeyEvents } from '@/components/match-key-events';
import { MatchLineups, MatchStats } from '@/components/match-stats-panels';
import { TopRated } from '@/components/match-top-rated';

/**
 * The match centre's moving modules as the server draws them (D-409): the
 * one place that says which card fills which live slot, used by the page
 * (`match/[id]/page.tsx`) and by `refreshLiveModules`, so a module drawn
 * again in play is the same card the page drew. Every state: before kick-off
 * the view puts the coming card in their place where it names them.
 *
 * No directive: a server module.
 */

interface SlotProps {
  centre: MatchCentre;
  locale: string;
  timeZone: string;
  words: MatchWords;
}

const DRAW: Record<LiveSlot, (props: SlotProps) => ReactNode> = {
  keyEvents: ({ centre, locale, timeZone, words }) => (
    <KeyEvents centre={centre} locale={locale} timeZone={timeZone} words={words} />
  ),
  // The Stats tab (T-1813): statistics, player tables, expected goals.
  matchStats: ({ centre, locale, words }) => (
    <MatchStats centre={centre} locale={locale} words={words} />
  ),
  // The line-ups with the marks so far, and the best rated (T-1814).
  matchLineups: ({ centre, locale, words }) => (
    <MatchLineups centre={centre} locale={locale} words={words} />
  ),
  topRated: ({ centre, locale, words }) => (
    <TopRated centre={centre} locale={locale} words={words} />
  ),
};

/** One live slot's card. */
export function liveSlot(slot: LiveSlot, props: SlotProps): ReactNode {
  return DRAW[slot](props);
}

/** Every live slot's card, as the page draws them. */
export function liveSlots(props: SlotProps): Record<LiveSlot, ReactNode> {
  const all = {} as Record<LiveSlot, ReactNode>;
  for (const slot of Object.keys(LIVE_SLOTS) as LiveSlot[]) all[slot] = DRAW[slot](props);
  return all;
}

const CLIENT_REFERENCE = Symbol.for('react.client.reference');

/**
 * A server card drawn once, so that the same answer can be handed to many
 * readers without drawing it again for each (review M1): every server
 * component in the tree is called now, leaving host elements and the client
 * components (`Link`, `LiveAge`), whose own children are drawn the same way.
 * The cards are pure functions of their props -- no hooks, no context, no
 * awaiting -- which is what makes this safe. A component that cannot be
 * called outside React (a client component in a test, where it is a plain
 * function) is left as it is, for React to draw: the same markup, only not
 * drawn ahead.
 */
export function prerender(node: ReactNode): ReactNode {
  if (Array.isArray(node)) return node.map(prerender);
  if (!isValidElement(node)) return node;
  const element = node as ReactElement<{ children?: ReactNode }>;
  const { type, props } = element;
  if (typeof type === 'function' && (type as { $$typeof?: symbol }).$$typeof !== CLIENT_REFERENCE) {
    try {
      return prerender((type as (p: typeof props) => ReactNode)(props));
    } catch {
      return node;
    }
  }
  if (typeof type === 'string' || type === Fragment || typeof type === 'function') {
    const children = props.children;
    if (children === undefined) return node;
    // Spread, so drawn children stay static children (no list keys needed).
    return Array.isArray(children)
      ? cloneElement(element, undefined, ...children.map(prerender))
      : cloneElement(element, undefined, prerender(children));
  }
  return node;
}
