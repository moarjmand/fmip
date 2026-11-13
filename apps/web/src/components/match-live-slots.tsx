import type { MatchCentre } from '@fmip/contracts';
import type { ReactNode } from 'react';
import { LIVE_SLOTS, type LiveSlot } from '@/lib/live-modules';
import type { MatchWords } from '@/lib/words-server';
import { KeyEvents } from '@/components/match-key-events';
import { MatchLineups, MatchStats } from '@/components/match-stats-panels';
import { TopRated } from '@/components/match-top-rated';

/**
 * The match centre's moving modules as the server draws them (D-409): the
 * one place that says which card fills which live slot, used by the page
 * (`match/[id]/page.tsx`) and by the live modules' address (`lib/live-modules-server`), so a module drawn
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
