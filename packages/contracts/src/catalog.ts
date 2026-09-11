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

/** `GET /competitions/:id?season=`. */
export interface CompetitionPage {
  competition: {
    id: string;
    name: string;
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

/** `GET /teams/:id`. */
export interface TeamPage {
  team: {
    id: string;
    name: string;
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
  next_match: TeamFixture | null;
  previous_match: TeamFixture | null;
  /** Not finished, soonest first; finished, newest first. Across the seasons above. */
  fixtures: TeamFixture[];
  results: TeamFixture[];
  /** Open player spells. Derived from our own records: `not_supplied` when none. */
  squad: Covered<SquadPlayer[]>;
  followers: number;
  last_updated_at: string | null;
}
