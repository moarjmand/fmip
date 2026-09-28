/**
 * `GET /fixtures/:id/competition-context` (T-840, blueprint 4.2): where the
 * two sides stood in this competition before the match -- their table or
 * group positions, or, in a knockout round, which round it is and the tie it
 * belongs to. Built from our own stored results only (D-038).
 *
 * The table is the one before kick-off: finished matches of the same table
 * that kicked off earlier, so a finished match's page still shows what was at
 * stake rather than the table it changed.
 */

import type { FormResult, KnockoutRoundKey, KnockoutTie } from './catalog';
import type { CoverageState, Covered } from './coverage';

/** One side's line in the table before the match. */
export interface ContextStanding {
  team: { id: string; name: string; short_name: string | null };
  position: number;
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goal_difference: number;
  points: number;
  /** Competition-only form: this table's last five results, most recent first. */
  form: FormResult[];
  /** Points behind first place; 0 for the side in first. */
  points_from_top: number;
  /** Points behind the side one place higher; null for the side in first. */
  points_to_place_above: number | null;
  /** Points clear of the side one place lower; null for the side in last. */
  points_clear_of_place_below: number | null;
}

export interface CompetitionContextTable {
  /** The season's league stage, or one group of a group stage. */
  scope: 'league' | 'group';
  /** The group's name when `scope` is `group`. */
  group_name: string | null;
  /**
   * Finished matches of this table played before this one's kick-off. Zero
   * means the table has not started: no positions are stated, `leader`,
   * `home` and `away` are null.
   */
  matches_counted: number;
  /** Teams in the table. */
  teams: number;
  leader: { team: { id: string; name: string; short_name: string | null }; points: number } | null;
  /** Null only when the table has not started (or, defensively, lacks the side). */
  home: ContextStanding | null;
  away: ContextStanding | null;
  /**
   * Where the qualification, promotion and relegation places fall. Our
   * records do not hold them for any competition yet, so this is
   * `not_supplied` and no gap to such a place is stated -- never a guessed
   * "top four" or "bottom three".
   */
  places: CoverageState;
}

/** The knockout tie this match belongs to. */
export interface CompetitionContextTie {
  /** The competition's own words for the round ("Round of 16"), else the stage's name. */
  round: string | null;
  /** The UEFA round, for the continental cups whose bracket T-630 draws; else null. */
  round_key: KnockoutRoundKey | null;
  /**
   * Matches the round plays per tie: the stage's own record, else the
   * continental format; null when neither says and we hold one match.
   */
  legs_expected: 1 | 2 | null;
  /**
   * The tie as the bracket reads it (T-630): every leg we hold, this match
   * included, and the aggregate and winner only once the legs decide it.
   * With `legs_expected` null, neither is judged.
   */
  tie: KnockoutTie;
}

export interface CompetitionContext {
  fixture_id: string;
  competition: {
    id: string;
    name: string;
    kind: 'league' | 'cup' | 'super_cup' | 'qualifying' | 'friendly';
  };
  season: { id: string; label: string };
  /** The phase this match is in, as our records name it. */
  stage: { name: string; kind: string } | null;
  round: string | null;
  group_name: string | null;
  /**
   * The league or group table before the match; null when this match is not
   * part of a table (a knockout round, a qualifier, a friendly).
   */
  table: Covered<CompetitionContextTable> | null;
  /** The knockout tie; null when this match is not a knockout one. */
  knockout: CompetitionContextTie | null;
}
