/**
 * Read endpoints over the catalog (T-010 tables). Only what a page needs so
 * far: the country list for registration, and the team and competition lists
 * for following. The competition page (T-035) is the first full shape; team
 * and player pages follow.
 */

import type { CoverageState, Covered } from './coverage';
import type { LeagueZones } from './league-zones';
import type { EntityMedia } from './media';

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
  /** `crest`: from our own origin (T-1320). */
  team: { id: string; name: string; short_name: string | null; crest?: EntityMedia };
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

/**
 * One group of a group stage on the competition page (T-1336), ranked as
 * the match centre's group line ranks it: the stage's finished matches that
 * carry the group's name.
 */
export interface GroupTable {
  /** The group stage it belongs to (e.g. "League A", "Group Stage"). */
  stage: { id: string; name: string };
  /** The group's own name ("A", "1"). */
  group: string;
  /** Finished matches the table is counted from; 0 means no positions yet. */
  counted: number;
  /** Ranked rows; empty while `counted` is 0, never a grid of noughts. */
  rows: TableRow[];
  /** Every team of the group, by name: what a group not yet started can still say. */
  teams: TableRow['team'][];
}

export interface Leader {
  /** `photo`: from our own origin (T-1320). */
  person: { id: string; name: string; photo?: EntityMedia };
  /** The team the goals were scored for; null when the participant is unknown. */
  team: { id: string; name: string; crest?: EntityMedia } | null;
  goals: number;
  /**
   * The scorer's minutes in this season of the competition, for every team
   * (T-824), under T-823's rule: a total only when every match played
   * carries the feed's minutes.
   */
  minutes: PlayerSeasonMinutes;
}

/**
 * The minimum-minutes filter on the leaders (T-824), `?min_minutes=` on
 * `GET /competitions/:id`. A scorer is listed under a floor only when the
 * record shows the floor was reached: an `available` total at or above it,
 * or a `limited` season whose supplied minutes alone reach it (they are "at
 * least"). A scorer whose record cannot show it -- `limited` below the
 * floor, or `not_supplied` -- is left out and counted in `unproven`, never
 * treated as short and never as long enough.
 */
export interface LeadersFilter {
  /** The floor applied; null when none was asked for. */
  min_minutes: number | null;
  /** Scorers left out because their recorded minutes cannot show the floor. */
  unproven: number;
  /** The floors the page offers as links. */
  presets: number[];
}

/** The floors offered on the competition page (T-824): five, ten and twenty full matches. */
export const LEADERS_MINUTES_PRESETS = [450, 900, 1800] as const;

/** The largest `?min_minutes=` accepted: more than any season holds. */
export const LEADERS_MINUTES_MAX = 10000;

/**
 * One row of a board beyond goals (T-943, D-118): who, for which team, and
 * their season minutes under the same rule as the scorers (T-824).
 */
export interface BoardPlayer {
  /** `photo`: from our own origin (T-1321). */
  person: { id: string; name: string; photo?: EntityMedia };
  /** The team the row counts for; null when the participant is unknown. `crest`: our own origin (T-1321). */
  team: { id: string; name: string; crest?: EntityMedia } | null;
  minutes: PlayerSeasonMinutes;
}

/** Assists: the scorer's assist on a goal or penalty goal, as the feed records it. */
export interface AssistLeader extends BoardPlayer {
  assists: number;
}

/**
 * Clean sheets: a goalkeeper who started a finished match in goal, was
 * neither substituted nor sent off, and whose side conceded nothing by the
 * latest score (after extra time where it was played; a shoot-out is not
 * conceding).
 */
export interface CleanSheetLeader extends BoardPlayer {
  clean_sheets: number;
  /** Finished matches this keeper started in goal for the team. */
  starts_in_goal: number;
}

/** Cards: a second yellow counts as a red, as on the player page; ranked by reds, then yellows. */
export interface CardLeader extends BoardPlayer {
  yellow_cards: number;
  red_cards: number;
}

/**
 * The competition page's boards beyond goals (T-943, D-118). Each is its own
 * module with its own coverage: a season whose goals carry no assist is
 * `not_supplied` for assists, never a board of zeros; clean sheets are
 * `limited` when some finished matches have no line-up naming a starting
 * goalkeeper. `leaders_filter`'s floor applies to every board; `unproven`
 * counts, per board, the players left out because their minutes cannot show
 * it.
 */
export interface LeaderBoards {
  assists: Covered<AssistLeader[]>;
  clean_sheets: Covered<CleanSheetLeader[]>;
  cards: Covered<CardLeader[]>;
  unproven: { assists: number; clean_sheets: number; cards: number };
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
    /** The competition's logo from our own origin (T-1320). */
    logo?: EntityMedia;
  };
  /** Newest first. */
  seasons: SeasonSummary[];
  /** The selected season: `?season=`, else the current one, else the newest. */
  season: SeasonSummary & { stages: StageSummary[] };
  /** League table over the season's league-stage results. */
  table: Covered<TableRow[]>;
  /**
   * Every group's table of the season's group stages (T-1336), in stage
   * order then group order; null for a season with no group stage, whose
   * page is `table` alone as before. `not_supplied` when a group stage
   * exists but no match of it carries a group yet.
   */
  group_tables: Covered<GroupTable[]> | null;
  /**
   * The season's qualification and relegation places from the committed
   * list (T-1167, D-171), or why there are none.
   */
  zones: LeagueZones;
  /** Finished matches, most recent first. */
  results: SeasonFixture[];
  /** Everything not finished, soonest first. */
  fixtures: SeasonFixture[];
  /** Top goalscorers from recorded goals, behind `leaders_filter` when one is asked for. */
  leaders: Covered<Leader[]>;
  leaders_filter: LeadersFilter;
  /** Assists, clean sheets and cards, each its own module (T-943). */
  boards: LeaderBoards;
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
  /** `photo`: from our own origin (T-1321). */
  person: { id: string; name: string; photo?: EntityMedia };
  shirt_number: number | null;
  position: SquadPosition | null;
  on_loan: boolean;
  /** ISO 8601 date the spell began. */
  since: string;
  /**
   * Minutes for this team in the seasons the page covers (T-824), under
   * T-823's rule. `matches` zero means no line-up of ours names the player.
   */
  minutes: PlayerSeasonMinutes;
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
    /** The team's crest from our own origin (T-1320). */
    crest?: EntityMedia;
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
  /** The coach named on the team's most recent line-up (T-944, D-119). */
  manager: TeamManager;
  followers: number;
  last_updated_at: string | null;
}

/**
 * The team's manager (blueprint 5.2, T-944, D-119): the coach the feed named
 * on the team's most recent stored line-up -- a fact about that match, never
 * a guess about the club. `coach` is `not_supplied` when that line-up names
 * no coach, or when no line-up of the team is stored (`lineup_fixture` null).
 */
export interface TeamManager {
  coach: Covered<{ id: string; name: string }>;
  /** The match whose line-up was read; null when the team has no stored line-up. */
  lineup_fixture: { id: string; kickoff_at: string } | null;
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
  /** Minutes played, from the feed's per-player statistics (T-823). */
  minutes: PlayerSeasonMinutes;
}

/**
 * Minutes in one season row (T-823), from the feed's per-match `minutes`
 * (`fixture_player_stat`), never estimated from starts. The matches that
 * should carry minutes are the ones the player played: a start, a
 * substitution on, or minutes above zero on record.
 *
 * - `available`: every one of them has minutes, and `total` is their sum
 *   (zero when the player was only an unused substitute).
 * - `limited`: some do and some do not; `total` is null, because the sum of
 *   the matches that have them is smaller than the season and must not be
 *   read as it. `supplied_minutes` is that sum, for a reader told it is
 *   "at least" and over how many matches.
 * - `not_supplied`: the player played and the feed sent minutes for none of
 *   those matches.
 */
export interface PlayerSeasonMinutes {
  coverage: 'available' | 'limited' | 'not_supplied';
  total: number | null;
  /** Matches the player played in (see above). */
  matches: number;
  /** Of those, how many carry the feed's minutes. */
  matches_with_minutes: number;
  /** The sum over `matches_with_minutes`: the whole season only when `available`. */
  supplied_minutes: number;
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
    /** The player's photo from our own origin (T-1320). */
    photo?: EntityMedia;
  };
  current_spell: PlayerSpell | null;
  /** Newest first. */
  spells: PlayerSpell[];
  /** Newest season first. Derived from line-ups: `not_supplied` when the player is in none. */
  record: Covered<PlayerSeasonRecord[]>;
  /** The last matches the player was named for, newest first. */
  recent_matches: Covered<PlayerMatch[]>;
  /** Whether the feed lists the player out or doubtful for their team's next match (T-1007, D-127). */
  availability: PlayerAvailability;
  last_updated_at: string | null;
}

/**
 * Why a player's availability says nothing (T-1007, D-127).
 *
 * - `no_team`: no open spell and no stored line-up names the player, so there
 *   is no team whose next match to read.
 * - `no_next_match`: the team has no scheduled match ahead in our records.
 * - `not_asked`: the feed has not yet been asked who misses that match; an
 *   empty list nobody asked for is not "not listed" (T-103).
 */
export type PlayerAvailabilityReason = 'no_team' | 'no_next_match' | 'not_asked';

/**
 * What the feed says about one player for one match, as the key players'
 * `KeyPlayerAvailability` says it: `out` or `doubtful` as the feed lists
 * them, `not_listed` when the feed was asked and does not list the player.
 * Never "fit": the feed never says that (T-103).
 */
export interface PlayerAvailabilityListing {
  status: 'out' | 'doubtful' | 'not_listed';
  kind: 'injury' | 'suspension' | 'illness' | 'other' | null;
  /** The feed's own words for the reason, when it gave any. */
  reason: string | null;
  /** When the feed first said this, or last changed it; `null` when not listed. */
  reported_at: string | null;
}

/**
 * The player page's current availability (blueprint 5.3, T-1007, D-127): the
 * team's next scheduled match and what the feed's absence list says about the
 * player for it. `listing.last_updated_at` is when the feed was last asked.
 */
export interface PlayerAvailability {
  /**
   * The team read: an open spell's (`spell`), else the team of the latest
   * stored line-up that names the player (`lineup`). With several open spells,
   * the one whose next match comes first.
   */
  team: { id: string; name: string; short_name: string | null; basis: 'spell' | 'lineup' } | null;
  fixture: {
    id: string;
    kickoff_at: string;
    opponent: { id: string; name: string; short_name: string | null } | null;
  } | null;
  listing: Covered<PlayerAvailabilityListing>;
  reason: PlayerAvailabilityReason | null;
}
