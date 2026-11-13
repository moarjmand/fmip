import type { MatchCentre } from '@fmip/contracts';
import type { LiveModules } from '@/lib/live-modules';
import type { MatchWords } from '@/lib/words-server';
import { KeyEvents } from '@/components/match-key-events';
import { MatchStats } from '@/components/match-stats-panels';

/**
 * The match centre's moving modules as the server draws them (D-409): the
 * one place that says which card fills which live slot, used by the page
 * (`match/[id]/page.tsx`) and by `refreshLiveModules`, so a module drawn
 * again in play is the same card the page drew. Every state: before kick-off
 * the view puts the coming card in their place where it names them.
 *
 * No directive: a server module.
 */
export function liveSlots({
  centre,
  locale,
  timeZone,
  words,
}: {
  centre: MatchCentre;
  locale: string;
  timeZone: string;
  words: MatchWords;
}): Required<LiveModules> {
  return {
    keyEvents: <KeyEvents centre={centre} locale={locale} timeZone={timeZone} words={words} />,
    // The Stats tab (T-1813): statistics, player tables, expected goals.
    matchStats: <MatchStats centre={centre} locale={locale} words={words} />,
  };
}
