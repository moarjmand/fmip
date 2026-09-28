/**
 * Read endpoints over the catalog (T-010 tables). Only what a page needs so
 * far: the country list for registration, and the team and competition lists
 * for following. The competition page (T-035) is the first full shape; team
 * and player pages follow.
 */

import type { CoverageState, Covered } from './coverage';

export interface CountrySummary {
  id: string;
  /** FIFA trigram, e.g. `ENG`. */
  code: string;
  /** ISO 3166-1 alpha-2 where one exists. */
  iso2: string | null;
  name: string;
}

/** `GET /countries`, sorted by name. */
export interface CountriesResponse {
  countries: CountrySummary[];
}

export interface TeamSummary {
  id: string;
  name: string;
  short_name: string | null;
  code: string | null;
  kind: 'club' | 'national';
  country_id: string | null;
}

/** `GET /teams`, sorted by name. */
export interface TeamsResponse {
  teams: TeamSummary[];
}

export interface CompetitionSummary {
  id: string;
  name: string;
  short_name: string | null;
  scope: 'domestic' | 'continental' | 'international';
  country_id: string | null;
}

/** `GET /competitions`, sorted by name. */
export interface CompetitionsResponse {
  competitions: CompetitionSummary[];
}

/** How many teams `GET /follow-suggestions` names under each competition. */
export const SUGGESTED_TEAMS_PER_COMPETITION = 5;

/** A team suggested to follow, with the count it was ranked by. */
export interface SuggestedTeam extends TeamSummary {
  /** Members following it now. The ranking's only input besides the name. */
  followers: number;
}

export interface SuggestedCompetition {
  competition: CompetitionSummary;
  /**
   * The season the teams come from: the current one, else the newest; `null`
   * when the competition holds no season yet, and then `teams` is empty.
   */
  season: { id: string; label: string } | null;
  /**
   * Up to `SUGGESTED_TEAMS_PER_COMPETITION` teams that play that season's
   * main phase (a league, group or knockout stage; not the qualifying rounds
   * or play-offs alone), most followed first, then by position in the
   * season's table when there is one, then by name. Empty when no fixture of
   * that phase names a team yet -- never filled from anywhere else.
   */
  teams: SuggestedTeam[];
}

/**
 * `GET /follow-suggestions` (T-622): what a member who follows nothing can
 * follow next, from what the site holds -- every active competition in its
 * scores-page order (T-504), each with the teams of its season that members
 * follow most. Public: it names no member.
 */
export interface FollowSuggestionsResponse {
  competitions: SuggestedCompetition[];
  /** The ranking, in words a page can repeat: followers first (ties by table position, then name). */
  ranked_by: 'followers';
}

// ---------------------------------------------------------------------------
// Competition page (blueprint 5.1, T-035): overview, season selector, table,
// fixtures and results, statistical leaders. Every module carries its
// coverage; the table and the leaders are computed from stored results and
// incidents, never ingested as opaque numbers (D-038).
// ---------------------------------------------------------------------------

export interface SeasonSummary {
  id: string;
  label: string;
  /** ISO 8601 dates. */
  start_date: string;
  end_date: string;
  is_current: boolean;
}

export interface StageSummary {
  id: string;
  name: string;
  kind: 'league' | 'group' | 'knockout' | 'playoff' | 'qualifying';
  sort_order: number;
  legs: 1 | 2;
}

export type FormResult = 'W' | 'D' | 'L';

export interface TableRow {
  position: number;
  team: { id: string; name: string; short_name: string | null };
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goals_for: number;
  goals_against: number;
  goal_difference: number;
  points: number;
  /** The last five results, most recent first. */
  form: FormResult[];
}

export interface Leader {
  person: { id: string; name: string };
  /** The team the goals were scored for; null when the participant is unknown. */
  team: { id: string; name: string } | null;
  goals: number;
}

export interface SeasonFixture {
  id: string;
  kickoff_at: string;
  status: string;
  round: string | null;
  stage: { id: string; name: string } | null;
  home: { id: string; name: string; short_name: string | null };
  away: { id: string; name: string; short_name: string | null };
  /** Full time when known, else the current score, else null. */
  score: { home: number; away: number } | null;
}

// ---------------------------------------------------------------------------
// Knockout bracket (blueprint 5.1, T-630): the UEFA cups' rounds after the
// league stage, built from stored fixtures only. A round nobody has drawn is
// said to be undrawn; a tie is never invented to fill it.
// ---------------------------------------------------------------------------

/** The knockout rounds in the order they are played. */
export const KNOCKOUT_ROUNDS = [
  'round_of_32',
  'knockout_playoff',
  'round_of_16',
  'quarter_final',
  'semi_final',
  'final',
] as const;
export type KnockoutRoundKey = (typeof KNOCKOUT_ROUNDS)[number];

export interface KnockoutTeam {
  id: string;
  name: string;
  short_name: string | null;
}

export interface KnockoutLeg {
  fixture_id: string;
  /** 1 or 2 in a two-legged tie; 1 for a single match. */
  leg: number;
  kickoff_at: string;
  status: string;
  home: KnockoutTeam;
  away: KnockoutTeam;
  /** The score after extra time when one was played; null until there is one. */
  score: { home: number; away: number } | null;
  /** Whether our records hold an extra-time score for this match. */
  after_extra_time: boolean;
  /** The shoot-out, when there was one. */
  penalties: { home: number; away: number } | null;
}

export interface KnockoutTie {
  /** The two teams, the first leg's hosts first. */
  teams: [KnockoutTeam, KnockoutTeam];
  /** Every match of the tie our records hold, in kick-off order. */
  legs: KnockoutLeg[];
  /**
   * Goals over the whole tie, in the order of `teams`; null until every leg
   * the round plays is finished. Null for a single-match round.
   */
  aggregate: [number, number] | null;
  /** Null until the finished legs decide the tie. */
  winner: KnockoutTeam | null;
  /** How the tie was decided; null while it is not. */
  decided_by: 'score' | 'aggregate' | 'penalties' | null;
}

export interface KnockoutRound {
  key: KnockoutRoundKey;
  /**
   * `drawn` — at least one tie of the round is in our records;
   * `not_drawn` — the season is still running and nothing of this round exists yet;
   * `not_supplied` — the round should exist (a later one does, or the season is over)
   * but our records hold none of its matches.
   */
  state: 'drawn' | 'not_drawn' | 'not_supplied';
  /** Matches per tie: 2, or 1 for the final. */
  legs: 1 | 2;
  /** Ties the round has in the format; more than `ties.length` means some are not known yet. */
  expected_ties: number;
  ties: KnockoutTie[];
}

export interface KnockoutBracket {
  rounds: KnockoutRound[];
}

/** `GET /competitions/:id?season=`. */
export interface CompetitionPage {
  competition: {
    id: string;
    name: string;
    /**
     * The name in the language the reader asked for (`?locale=`), or `null`
     * when nobody has written one (T-303). Beside `name`, never in its place:
     * the canonical name is the entity's, and a page that shows the localised
     * one still knows what it is a name for.
     */
    localised_name: string | null;
    short_name: string | null;
    kind: 'league' | 'cup' | 'super_cup' | 'qualifying' | 'friendly';
    scope: 'domestic' | 'continental' | 'international';
    gender: 'men' | 'women';
    age_group: string;
    tier: number | null;
    country: { id: string; name: string; code: string } | null;
  };
  /** Newest first. */
  seasons: SeasonSummary[];
  /** The selected season: `?season=`, else the current one, else the newest. */
  season: SeasonSummary & { stages: StageSummary[] };
  /** League table over the season's league-stage results. */
  table: Covered<TableRow[]>;
  /** Finished matches, most recent first. */
  results: SeasonFixture[];
  /** Everything not finished, soonest first. */
  fixtures: SeasonFixture[];
  /** Top goalscorers from recorded goals. */
  leaders: Covered<Leader[]>;
  /**
   * The knockout rounds for a continental cup (T-630); null for a
   * competition that does not play them.
   */
  bracket: KnockoutBracket | null;
  /** The season's declared coverage per module. */
  coverage: Record<string, CoverageState>;
  /** Newest change to any fixture of the season; null when none is stored. */
  last_updated_at: string | null;
}

// ---------------------------------------------------------------------------
// Team page (blueprint 5.2, T-036): overview, current competitions with the
// table context, next and previous match, fixtures and results, squad,
// follower count.
// ---------------------------------------------------------------------------

/** A fixture as the team page lists it: the competition and season named, since the list spans them. */
export interface TeamFixture extends SeasonFixture {
  competition: { id: string; name: string; short_name: string | null };
  season: { id: string; label: string };
}

/** A fixture on the team page's own lists (T-632): the extra time and the shoot-out said. */
export interface TeamPageFixture extends TeamFixture {
  /**
   * `score` is the latest we hold: after extra time where it was played, as
   * the bracket reads it (T-632), so the result letter agrees with the
   * team's figures. True when an extra-time score is on record.
   */
  after_extra_time: boolean;
  /** The shoot-out, when there was one; it decides the tie, not the match (a draw). */
  penalties: { home: number; away: number } | null;
}

/** Where the team stands: its row and up to two neighbours either side. */
export interface TableContext {
  position: number;
  /** Rows on the whole table. */
  total: number;
  points: number;
  rows: TableRow[];
}

export interface TeamCompetition {
  competition: { id: string; name: string; short_name: string | null };
  season: { id: string; label: string; is_current: boolean };
  context: Covered<TableContext>;
}

export type SquadPosition = 'goalkeeper' | 'defender' | 'midfielder' | 'forward';

export interface SquadPlayer {
  person: { id: string; name: string };
  shirt_number: number | null;
  position: SquadPosition | null;
  on_loan: boolean;
  /** ISO 8601 date the spell began. */
  since: string;
}

/**
 * Team statistics averaged per match on the team page (T-632), from the
 * team's own side of `fixture_stat`. A closed list, in display order.
 */
export const TEAM_AVERAGE_METRICS = [
  'possession_pct',
  'shots',
  'shots_on_target',
  'corners',
  'fouls',
  'pass_accuracy_pct',
  'expected_goals',
] as const;
export type TeamAverageMetric = (typeof TEAM_AVERAGE_METRICS)[number];

/** Results and goals over one split (home, away or both) of the counted matches. */
export interface TeamSplitRecord {
  played: number;
  won: number;
  /** Includes a match decided by a penalty shoot-out: the shoot-out is not a result. */
  drawn: number;
  lost: number;
  /** After extra time where it was played; never the shoot-out. */
  goals_for: number;
  goals_against: number;
  clean_sheets: number;
}

/** One statistic averaged per match, per split. */
export interface TeamStatAverage {
  metric: TeamAverageMetric;
  /**
   * `available` — every counted match holds the figure, so all three averages
   * are complete; `limited` — some do, and a split is averaged only when every
   * one of its matches holds it; `not_supplied` — none does.
   */
  coverage: 'available' | 'limited' | 'not_supplied';
  /** Counted matches holding the figure, per split. */
  matches_with_figure: { home: number; away: number; total: number };
  /**
   * The mean over every match of the split, rounded to two places; null when
   * the split has no match or any of its matches lacks the figure — never a
   * partial average presented as complete.
   */
  home: number | null;
  away: number | null;
  total: number | null;
}

/**
 * A team's figures in one competition's season (blueprint 5.2, T-632),
 * computed from our stored finished fixtures only.
 */
export interface TeamCompetitionSplits {
  competition: { id: string; name: string; short_name: string | null };
  season: { id: string; label: string; is_current: boolean };
  home: TeamSplitRecord;
  away: TeamSplitRecord;
  total: TeamSplitRecord;
  /** Counted matches that went to a shoot-out (in `drawn`). */
  penalty_shootouts: number;
  /** Finished matches we hold no score for: not counted anywhere above. */
  finished_without_score: number;
  /** One entry per `TEAM_AVERAGE_METRICS`, in that order; empty when nothing is counted. */
  averages: TeamStatAverage[];
  /** Newest change to a counted match; null when none is counted. */
  last_updated_at: string | null;
}

/** `GET /teams/:id`. */
export interface TeamPage {
  team: {
    id: string;
    name: string;
    /**
     * The name in the language the reader asked for (`?locale=`), or `null`
     * when nobody has written one (T-303). Beside `name`, never in its place:
     * the canonical name is the entity's, and a page that shows the localised
     * one still knows what it is a name for.
     */
    localised_name: string | null;
    short_name: string | null;
    code: string | null;
    kind: 'club' | 'national';
    gender: 'men' | 'women';
    age_group: string;
    founded_year: number | null;
    country: { id: string; name: string; code: string } | null;
    venue: { id: string; name: string; city: string | null; capacity: number | null } | null;
  };
  /** Competitions with a current season, or one the team still has matches in. */
  competitions: TeamCompetition[];
  /** The soonest match not yet finished, and the most recent finished one. */
  next_match: TeamPageFixture | null;
  previous_match: TeamPageFixture | null;
  /** Not finished, soonest first; finished, newest first. Across the seasons above. */
  fixtures: TeamPageFixture[];
  results: TeamPageFixture[];
  /** Open player spells. Derived from our own records: `not_supplied` when none. */
  squad: Covered<SquadPlayer[]>;
  /**
   * Home / away / total figures per competition (T-632), one entry per
   * `competitions` entry and in the same order.
   */
  splits: TeamCompetitionSplits[];
  followers: number;
  last_updated_at: string | null;
}

// ---------------------------------------------------------------------------
// Player page (blueprint 5.3, T-037): identity, current team, career spells,
// a record per season and competition from line-ups and incidents, and the
// recent-match log. Every lineup, squad and scorer name links here.
// ---------------------------------------------------------------------------

export interface PlayerSpell {
  team: { id: string; name: string; short_name: string | null };
  /** ISO 8601 dates; `end_date` null while the spell is open. */
  start_date: string;
  end_date: string | null;
  shirt_number: number | null;
  position: SquadPosition | null;
  on_loan: boolean;
}

/** What our line-ups and incidents say about one season with one team in one competition. */
export interface PlayerSeasonRecord {
  season: { id: string; label: string };
  competition: { id: string; name: string; short_name: string | null };
  team: { id: string; name: string };
  starts: number;
  /** Named on the bench and brought on. */
  sub_appearances: number;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
}

export interface PlayerMatch {
  /**
   * The latest score, after extra time where it was played, and the
   * shoot-out beside it -- as the team page reads it (T-822).
   */
  fixture: TeamPageFixture;
  team: { id: string; name: string };
  role: 'starter' | 'bench';
  /** For a bench role: whether a substitution brought the player on. */
  came_on: boolean;
  goals: number;
  assists: number;
  yellow_cards: number;
  red_cards: number;
}

/** `GET /players/:id`. */
export interface PlayerPage {
  person: {
    id: string;
    full_name: string;
    known_as: string | null;
    /**
     * The name in the language the reader asked for (`?locale=`), or `null`
     * when nobody has written one (T-303). Beside `name`, never in its place:
     * the canonical name is the entity's, and a page that shows the localised
     * one still knows what it is a name for.
     */
    localised_name: string | null;
    /** ISO 8601 date, when recorded. */
    date_of_birth: string | null;
    nationality: { id: string; name: string; code: string } | null;
    height_cm: number | null;
    preferred_foot: 'left' | 'right' | 'both' | null;
  };
  current_spell: PlayerSpell | null;
  /** Newest first. */
  spells: PlayerSpell[];
  /** Newest season first. Derived from line-ups: `not_supplied` when the player is in none. */
  record: Covered<PlayerSeasonRecord[]>;
  /** The last matches the player was named for, newest first. */
  recent_matches: Covered<PlayerMatch[]>;
  last_updated_at: string | null;
}
