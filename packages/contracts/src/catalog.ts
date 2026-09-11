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
