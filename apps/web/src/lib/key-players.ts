import type { KeyPlayer, KeyPlayersSide } from '@fmip/contracts';
import { KEY_PLAYERS_PER_SIDE } from '@fmip/contracts';

/**
 * The words of the match centre's key players (T-841). Pure, so the stated
 * rule and what is said -- and not said -- about availability are one tested
 * place.
 */

/** The footnote: how "key" is chosen, so the selection is a count anyone can check. */
export function ruleNote(competition: string, season: string): string {
  return `Key players are each side's ${KEY_PLAYERS_PER_SIDE} with the most minutes in ${competition} ${season} before this match, counted from the feed's per-match player figures; a tie on minutes goes to more goals plus assists, then the name. Goals and assists are summed from the same figures. This is a count, not a judgement of quality, and no rating is used.`;
}

const POSITION: Record<NonNullable<KeyPlayer['position']>, string> = {
  goalkeeper: 'Goalkeeper',
  defender: 'Defender',
  midfielder: 'Midfielder',
  forward: 'Forward',
};

export function positionLabel(position: KeyPlayer['position']): string | null {
  return position === null ? null : POSITION[position];
}

/** "1,234 min in 15 · 6 goals · 2 assists". */
export function figuresLine(player: KeyPlayer, format: (n: number) => string): string {
  const count = (n: number, one: string, many: string) => `${format(n)} ${n === 1 ? one : many}`;
  return [
    `${format(player.minutes)} min in ${count(player.appearances, 'match', 'matches')}`,
    count(player.goals, 'goal', 'goals'),
    count(player.assists, 'assist', 'assists'),
  ].join(' · ');
}

/**
 * What the provider said about the player for this match. Null when it was
 * never asked: nothing is claimed. A doubt is a doubt, never "out" and never
 * "available".
 */
export function availabilityLine(player: KeyPlayer): string | null {
  const a = player.availability;
  if (a === null) return null;
  if (a.status === 'not_listed') return 'Not on the provider’s absence list';
  const status = a.status === 'out' ? 'Out' : 'Doubtful';
  return a.reason === null ? status : `${status} · ${a.reason}`;
}

/** How much of the team's season the figures cover. */
export function coverageLine(side: KeyPlayersSide): string {
  if (side.matches_played === 0) {
    return 'No match of this competition played before this one, so no minutes to count yet.';
  }
  if (side.matches_with_figures < side.matches_played) {
    return `From player figures for ${side.matches_with_figures} of ${side.matches_played} matches played: the other matches have none, so these totals are a floor.`;
  }
  return `From player figures for all ${side.matches_played} ${side.matches_played === 1 ? 'match' : 'matches'} played.`;
}
