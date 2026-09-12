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
import type { FixtureStatus, Freshness, ScoreCardTeam, ScoreLine } from './scores';

export interface MatchTeam extends ScoreCardTeam {
  /** From `fixture_participant`; the confirmed formation when known. */
  formation: string | null;
  coach: { id: string; name: string } | null;
}

export interface MatchHeader {
  id: string;
  kickoff_at: string;
  status: FixtureStatus;
  minute: number | null;
  competition: { id: string; name: string; short_name: string | null; country_id: string | null };
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
  venue: { id: string; name: string; city: string | null } | null;
  is_neutral_venue: boolean;
  referee: { id: string; name: string } | null;
  attendance: number | null;
  /** Playing periods with real start and end times; an open `ended_at` is the one in progress. */
  periods: MatchPeriod[];
  /** When anything on this fixture last changed (rule 4). */
  last_updated_at: string;
  /** `stale` when live and unchanged for `STALE_LIVE_AFTER_MS` (T-083); `null` when not live. */
  freshness: Freshness | null;
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
  detail: string | null;
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

export interface MatchLineupPlayer {
  id: string;
  name: string;
  role: 'starter' | 'bench';
  shirt_number: number | null;
  position: 'goalkeeper' | 'defender' | 'midfielder' | 'forward' | null;
  is_captain: boolean;
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
  /** Last five competitive matches before this one, newest first, per side. */
  form: { home: Covered<FormEntry[]>; away: Covered<FormEntry[]> };
  /** Recent meetings of the two teams before this one, newest first. */
  head_to_head: Covered<HeadToHeadEntry[]>;
  /** The season's declared coverage per module (blueprint 4.3); `not_supplied` where none is recorded. */
  coverage: Record<CoverageModule, CoverageState>;
}
