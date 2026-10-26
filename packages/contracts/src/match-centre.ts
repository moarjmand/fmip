/**
 * `GET /fixtures/:id` (T-033): the match centre of blueprint 4.2 as far as
 * the platform's own tables reach — header, timeline, statistics, line-ups,
 * recent form, head-to-head — each module wrapped in `Covered` so the page
 * shows a labelled state instead of an empty box (blueprint 4.3, rule 3).
 *
 * Forecast (T-065), founder's analysis, community forecast, availability,
 * key players, watch and news are not in this shape; they arrive with their
 * own tasks and the page labels them until then.
 */

import type { CoverageState, Covered } from './coverage';
import type { EntityMedia } from './media';
import type { FixtureStatus, Freshness, ScoreCardTeam, ScoreLine } from './scores';

export interface MatchTeam extends ScoreCardTeam {
  /** From `fixture_participant`; the confirmed formation when known. */
  formation: string | null;
  coach: { id: string; name: string } | null;
}

/** What a pitch is laid with (T-1438). */
export type VenueSurface = 'grass' | 'artificial' | 'hybrid';

/**
 * A ground's card on the match page (T-1438, D-229). Each fact is null when
 * the provider has not given it. `coverage` is over the address, capacity
 * and surface: `available` all three, `limited` some, `not_supplied` none
 * after the provider was asked, `delayed` none because it has not been asked
 * yet. The picture carries its own coverage, from our own origin (D-176).
 */
export interface VenueDetails {
  address: string | null;
  capacity: number | null;
  surface: VenueSurface | null;
  image: EntityMedia;
  coverage: CoverageState;
}

export interface MatchHeader {
  id: string;
  kickoff_at: string;
  status: FixtureStatus;
  minute: number | null;
  /**
   * The live match is at the half-time interval, as the feed last said
   * (T-1551); `false` for every match that is not live. Optional so an
   * older API's payload still reads as "not said".
   */
  at_half_time?: boolean;
  competition: {
    id: string;
    name: string;
    short_name: string | null;
    country_id: string | null;
    /** The competition's logo from our own origin (T-1320). */
    logo?: EntityMedia;
  };
  season: { id: string; label: string };
  stage: { id: string; name: string; kind: string } | null;
  round: string | null;
  group_name: string | null;
  leg: 1 | 2 | null;
  home: MatchTeam;
  away: MatchTeam;
  scores: {
    current: ScoreLine | null;
    half_time: ScoreLine | null;
    full_time: ScoreLine | null;
    extra_time: ScoreLine | null;
    penalties: ScoreLine | null;
    aggregate: ScoreLine | null;
  };
  venue: {
    id: string;
    name: string;
    city: string | null;
    /** The ground's card (T-1438, D-229); absent where a builder does not attach it. */
    details?: VenueDetails;
  } | null;
  is_neutral_venue: boolean;
  /**
   * The referee as the provider names him, plain text (T-1438, D-229): no
   * entity, no page, never a key. Null when the source has named nobody.
   */
  referee: { name: string } | null;
  attendance: number | null;
  /** Playing periods with real start and end times; an open `ended_at` is the one in progress. */
  periods: MatchPeriod[];
  /** When anything on this fixture last changed (rule 4). */
  last_updated_at: string;
  /**
   * When the provider's live list last answered while this match was live
   * or suspended, changed or not (T-1394, D-209); null otherwise, or when no
   * answer is recorded. `liveFreshnessFrom` reads it where no clock moves.
   */
  live_answered_at?: string | null;
  /** `stale` when live and unchanged for `STALE_LIVE_AFTER_MS` (T-083, see `liveFreshnessFrom`); `null` when not live. */
  freshness: Freshness | null;
  /**
   * When this match's fixture list was last answered, changed or not
   * (T-1371, D-189): the season's last whole-season ask, or its last window
   * ask when the window held the kick-off date. The fixture lists are asked
   * hourly, so a scheduled match whose row has not changed for days was still
   * checked an hour ago. Null when no such ask is recorded. `last_updated_at`
   * stays the time of the last change, which is what the freshness rule
   * measures.
   */
  last_checked_at?: string | null;
}

export interface MatchPeriod {
  kind: 'first_half' | 'second_half' | 'extra_time_first' | 'extra_time_second' | 'penalties';
  sequence: number;
  started_at: string;
  ended_at: string | null;
  added_minutes: number | null;
}

export type MatchIncidentKind =
  | 'goal'
  | 'own_goal'
  | 'penalty_goal'
  | 'penalty_missed'
  | 'yellow_card'
  | 'second_yellow_card'
  | 'red_card'
  | 'substitution'
  | 'var';

/**
 * What an incident adds to its kind, in our words (T-1378, D-196): what a VAR
 * review decided. `null` when it adds nothing or when the provider's detail
 * could not be named; the provider's text is never carried (rule 2).
 */
export type MatchIncidentDetail =
  | 'goal_cancelled'
  | 'goal_confirmed'
  | 'penalty_awarded'
  | 'penalty_cancelled'
  | 'penalty_confirmed'
  | 'card_upgraded'
  | 'card_cancelled';

export interface MatchIncident {
  id: string;
  sequence: number;
  minute: number;
  added_time: number | null;
  kind: MatchIncidentKind;
  side: 'home' | 'away' | null;
  player: { id: string; name: string } | null;
  /** The assist, or the player coming on. */
  related_player: { id: string; name: string } | null;
  detail: MatchIncidentDetail | null;
}

export type MatchStatMetric =
  | 'possession_pct'
  | 'shots'
  | 'shots_on_target'
  | 'shots_off_target'
  | 'blocked_shots'
  | 'corners'
  | 'offsides'
  | 'fouls'
  | 'yellow_cards'
  | 'red_cards'
  | 'passes'
  | 'passes_accurate'
  | 'pass_accuracy_pct'
  | 'saves'
  | 'expected_goals';

/** One metric, both sides; a side the provider left out is `null`, never 0. */
export interface MatchStatRow {
  metric: MatchStatMetric;
  home: number | null;
  away: number | null;
}

/**
 * The per-player metrics a match can carry (T-101), mirroring
 * `fixture_player_stat_metric_check`. `rating` is the provider's own 0-10
 * mark. Per-player expected goals are not among them: they come from a
 * source of their own (`MatchPlayerExpected`, T-1432).
 */
export type PlayerMatchMetric =
  | 'minutes'
  | 'rating'
  | 'shots'
  | 'shots_on_target'
  | 'goals'
  | 'assists'
  | 'key_passes'
  | 'passes'
  | 'tackles'
  | 'blocks'
  | 'interceptions'
  | 'duels'
  | 'duels_won'
  | 'dribbles'
  | 'dribbles_won'
  | 'fouls_drawn'
  | 'fouls_committed'
  | 'offsides'
  | 'yellow_cards'
  | 'red_cards'
  | 'saves'
  | 'goals_conceded';

/** One player's numbers in this match; a metric missing here was not supplied, never 0. */
export interface MatchPlayerStats {
  id: string;
  name: string;
  side: 'home' | 'away';
  stats: Partial<Record<PlayerMatchMetric, number>>;
}

/**
 * The expected-goals family (T-1432, D-224), mirroring
 * `fixture_player_expected_metric_check`: expected goals, expected assists,
 * expected goals on target, xGOT conceded (a keeper's) and goals prevented
 * (xGOT conceded minus goals let in; may be negative).
 */
export type ExpectedGoalsMetric = 'xg' | 'xa' | 'xgot' | 'xgot_conceded' | 'xgp';

/**
 * Who supplied a player's expected goals. One source today; named on every
 * figure because it is never blended with another source's numbers (rule 6's
 * spirit) and a reader is told whose model it is ("xG (Highlightly)").
 */
export type ExpectedGoalsSource = 'highlightly';

/** One player's expected-goals figures in this match; a figure missing here was not supplied, never 0. */
export interface MatchPlayerExpected {
  id: string;
  name: string;
  side: 'home' | 'away';
  figures: Partial<Record<ExpectedGoalsMetric, number>>;
}

/**
 * The match's per-player expected goals from their one source (T-1432).
 * `available` when every player the source listed is one of ours, `limited`
 * when some are not mapped yet (`unplaced` of them, not shown), `delayed` for
 * a finished match of a covered competition the source has not been asked
 * about yet, `not_supplied` otherwise -- including a box score that carried no
 * figure. `last_updated_at` is when the source answered.
 */
export type MatchExpectedGoals = Covered<MatchPlayerExpected[]> & {
  source: ExpectedGoalsSource;
  unplaced: number;
};

/**
 * A player the provider says will miss (`out`) or may miss (`doubtful`) this
 * match (T-103), with its words for why and when it said so.
 */
/**
 * Why a player will miss a match, in our words (T-1601): the body part an
 * injury is in, a suspension's cause, or a reason that is not fitness. A page
 * draws it in the reader's language; `null` when the feed gave no reason or
 * one we cannot name, and the page then says the broad `kind`.
 */
export type AbsenceReasonCode =
  | 'injury'
  | 'knee'
  | 'muscle'
  | 'thigh'
  | 'hamstring'
  | 'groin'
  | 'calf'
  | 'ankle'
  | 'achilles'
  | 'foot'
  | 'heel'
  | 'toe'
  | 'leg'
  | 'hip'
  | 'pelvis'
  | 'back'
  | 'abdomen'
  | 'chest'
  | 'ribs'
  | 'shoulder'
  | 'collarbone'
  | 'arm'
  | 'wrist'
  | 'hand'
  | 'head'
  | 'eye'
  | 'tendon'
  | 'lower_body'
  | 'upper_body'
  | 'knock'
  | 'fracture'
  | 'surgery'
  | 'concussion'
  | 'hernia'
  | 'illness'
  | 'heart'
  | 'health'
  | 'red_card'
  | 'yellow_cards'
  | 'suspended'
  | 'doping'
  | 'inactive'
  | 'off_roster'
  | 'lacking_fitness'
  | 'coach_decision'
  | 'rest'
  | 'personal'
  | 'overload'
  | 'loan_agreement'
  | 'international_duty';

export interface MatchAbsence {
  id: string;
  name: string;
  side: 'home' | 'away';
  status: 'out' | 'doubtful';
  kind: 'injury' | 'suspension' | 'illness' | 'other' | null;
  /**
   * The feed's own words, in English whatever the reader's language: for an
   * English page at most. A page draws `reason_code` (T-1601).
   */
  reason: string | null;
  /** The reason in our words (T-1601); always sent, optional for older readers. */
  reason_code?: AbsenceReasonCode | null;
  reported_at: string;
}

/**
 * Why a match's absence list says nothing (T-1364).
 *
 * - `not_covered`: the provider does not report absences for this
 *   competition's season, so an empty answer from it would not mean nobody.
 * - `not_yet`: a match more than about three days away; absences are asked
 *   for, and published, from about three days before kick-off.
 * - `not_asked`: the provider was not asked about this match.
 */
export type MatchAbsenceGap = 'not_covered' | 'not_yet' | 'not_asked';

/**
 * How old an absence answer may be before a match page says it may have
 * changed (rule 4, D-127): the feed is re-asked every three hours before
 * kick-off, so six hours means at least one re-ask was missed. Shared by the
 * player page and the match centre (T-1371).
 */
export const AVAILABILITY_STALE_AFTER_MS = 6 * 60 * 60 * 1000;

/**
 * A starter's place in the side's shape (T-1397, D-212): `row` counts the
 * lines from the goalkeeper's (1) towards the halfway line, `col` counts
 * across a line from the side's own left as it attacks (1). Whole numbers
 * from 1.
 */
export interface LineupGrid {
  row: number;
  col: number;
}

export interface MatchLineupPlayer {
  id: string;
  name: string;
  role: 'starter' | 'bench';
  shirt_number: number | null;
  position: 'goalkeeper' | 'defender' | 'midfielder' | 'forward' | null;
  is_captain: boolean;
  /**
   * Where the starter stood, when the line-up says (T-1397, D-212). Null for
   * the bench, for a provider that gives no place and for a line-up stored
   * before places were kept.
   */
  grid: LineupGrid | null;
  /** The player's photo from our own origin (T-1320). */
  photo?: EntityMedia;
}

export interface MatchLineups {
  home: MatchLineupPlayer[];
  away: MatchLineupPlayer[];
}

/** One of a team's last competitive matches before this one. */
export interface FormEntry {
  fixture_id: string;
  kickoff_at: string;
  competition: { id: string; name: string };
  opponent: { id: string; name: string };
  /** The team played at home. */
  home: boolean;
  goals_for: number;
  goals_against: number;
  result: 'W' | 'D' | 'L';
}

export interface HeadToHeadEntry {
  fixture_id: string;
  kickoff_at: string;
  competition: { id: string; name: string };
  home: { id: string; name: string };
  away: { id: string; name: string };
  full_time: ScoreLine;
  venue: string | null;
}

export type CoverageModule =
  | 'scores'
  | 'incidents'
  | 'lineups'
  | 'statistics'
  | 'standings'
  | 'availability'
  | 'advanced_statistics';

export interface MatchCentre {
  fixture: MatchHeader;
  timeline: Covered<MatchIncident[]>;
  statistics: Covered<MatchStatRow[]>;
  lineups: Covered<MatchLineups>;
  /**
   * Who will or may miss the match (T-103), home side first. Once the provider
   * has been asked, an empty list is its answer -- nobody -- and
   * `last_updated_at` is when it was asked; never asked is `not_supplied`.
   * A `not_supplied` list says why in `gap` (T-1364).
   */
  availability: Covered<MatchAbsence[]> & { gap?: MatchAbsenceGap | null };
  /** Each player who took part, home side first, most minutes first (T-101). */
  player_statistics: Covered<MatchPlayerStats[]>;
  /**
   * Per-player expected goals from their own source, home side first, most
   * xG first (T-1432). Apart from `player_statistics` on purpose: another
   * source's figures, never merged into that table's numbers.
   */
  player_expected_goals: MatchExpectedGoals;
  /** Last five competitive matches before this one, newest first, per side. */
  form: { home: Covered<FormEntry[]>; away: Covered<FormEntry[]> };
  /** Recent meetings of the two teams before this one, newest first. */
  head_to_head: Covered<HeadToHeadEntry[]>;
  /** The season's declared coverage per module (blueprint 4.3); `not_supplied` where none is recorded. */
  coverage: Record<CoverageModule, CoverageState>;
}
