/**
 * `GET /fixtures/:id/key-players` (T-841, blueprint 4.2): each side's most
 * used players in this competition's season before the match, their season
 * figures and whether the provider says they will miss it.
 *
 * "Key" is a stated rule, not a judgement: the `KEY_PLAYERS_PER_SIDE` players
 * with the most minutes for the team in this competition's season, counted
 * from the per-match player figures of the matches that kicked off before
 * this one; a tie on minutes goes to more goals plus assists, then to the
 * name. No rating is shown or used.
 */

import type { Covered } from './coverage';
import type { MatchAbsenceGap } from './match-centre';

/** How many players a side shows. */
export const KEY_PLAYERS_PER_SIDE = 3;

/**
 * What the provider said about this match (T-103): `out` or `doubtful` with
 * its reason, or `not_listed` -- asked, and the player was not on its list.
 */
export interface KeyPlayerAvailability {
  status: 'out' | 'doubtful' | 'not_listed';
  kind: 'injury' | 'suspension' | 'illness' | 'other' | null;
  reason: string | null;
}

export interface KeyPlayer {
  id: string;
  name: string;
  /** The position of the player's latest line-up entry for the team this season; null when none says. */
  position: 'goalkeeper' | 'defender' | 'midfielder' | 'forward' | null;
  /** Matches with minutes recorded for him. */
  appearances: number;
  minutes: number;
  /** Summed from the same per-match figures; a match without figures adds nothing. */
  goals: number;
  assists: number;
  /** Null when the provider was never asked about this match: no claim either way. */
  availability: KeyPlayerAvailability | null;
}

export interface KeyPlayersSide {
  team: { id: string; name: string };
  /** The team's finished matches in this competition's season before kick-off. */
  matches_played: number;
  /**
   * Of those, the matches whose per-match player figures we hold. Fewer than
   * `matches_played` makes the side `limited`: the minutes are a floor, never
   * presented as the whole season.
   */
  matches_with_figures: number;
  /** Up to `KEY_PLAYERS_PER_SIDE`, most minutes first. Empty only before the team's first match. */
  players: KeyPlayer[];
}

export interface KeyPlayers {
  fixture_id: string;
  competition: { id: string; name: string };
  season: { id: string; label: string };
  home: Covered<KeyPlayersSide>;
  away: Covered<KeyPlayersSide>;
  /**
   * When the provider was last asked who will miss this match; null when it
   * never was (T-103), or when its answer is no answer (`availability_gap`).
   */
  availability_asked_at: string | null;
  /**
   * Why nothing is claimed about absences, the match centre's own
   * `availability.gap` for the same match (T-1371): one state, so the two
   * modules on a page never contradict each other. Null once there is an answer.
   */
  availability_gap?: MatchAbsenceGap | null;
}
