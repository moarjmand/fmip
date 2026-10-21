import type { Covered } from './coverage';

/**
 * A team's statistics for one season of one competition as the data provider
 * counts them (T-1437, D-228), shown as the provider's, beside -- never mixed
 * into -- the table and the splits we compute from the matches we ingest.
 */

/** A count at home, away, and their sum; any part the provider left out is `null`, never zero. */
export interface TeamSeasonCount {
  home: number | null;
  away: number | null;
  /** `null` when either side is. */
  total: number | null;
}

/** Goals in one band of minutes ("0-15" is `from` 0, `to` 15); bands without a goal are left out. */
export interface TeamSeasonMinuteBand {
  from: number;
  to: number;
  goals: number;
}

/** A biggest win or defeat, the team's goals first. */
export interface TeamSeasonScore {
  for: number;
  against: number;
}

/** One season of one competition the team has the provider's statistics for. */
export interface TeamSeasonStatsChoice {
  season_id: string;
  /** Our catalogue's name for the season ("2026/27"). */
  label: string;
  is_current: boolean;
  competition: { id: string; name: string; short_name: string | null };
}

export interface TeamSeasonStatsLine {
  played: TeamSeasonCount;
  wins: TeamSeasonCount;
  draws: TeamSeasonCount;
  losses: TeamSeasonCount;
  goals_for: TeamSeasonCount;
  goals_against: TeamSeasonCount;
  clean_sheets: TeamSeasonCount;
  failed_to_score: TeamSeasonCount;
  /** "W", "D" and "L", oldest first, newest last. */
  form: string | null;
  /**
   * `null` when the provider gave none, or when `bands_withheld`: its bands
   * missed its own goal totals (a cup's count shoot-out kicks), so neither
   * they nor the penalties are shown (D-228).
   */
  goals_for_by_minute: TeamSeasonMinuteBand[] | null;
  goals_against_by_minute: TeamSeasonMinuteBand[] | null;
  bands_withheld: boolean;
  penalties: { scored: number | null; missed: number | null };
  biggest_win: { home: TeamSeasonScore | null; away: TeamSeasonScore | null };
  biggest_defeat: { home: TeamSeasonScore | null; away: TeamSeasonScore | null };
  /** The longest runs of wins, draws and defeats. */
  longest_run: { wins: number | null; draws: number | null; losses: number | null };
  /** Each formation the team started in and how often, most used first. */
  formations: { formation: string; played: number }[];
}

/**
 * `GET /teams/:id/season-stats?season=`. `seasons` lists every season the
 * provider has statistics for this team in, current first, then newest.
 * `selected` is the one asked for (`?season=`, a season id the team played
 * in), else the first listed, else the team's latest season; `null` for a
 * team that has played in none. `stats` is `available` when the provider
 * gave the season whole, `limited` when it left part out or its minute bands
 * were withheld, and `not_supplied` before the provider was asked
 * (`asked: false`) or when it has no statistics for the team there.
 */
export interface TeamSeasonStats {
  /** Who counted these numbers, for the page to say so ("API-Football"). */
  source_name: string;
  seasons: TeamSeasonStatsChoice[];
  selected: TeamSeasonStatsChoice | null;
  /** Whether the provider has answered about the selected season. */
  asked: boolean;
  stats: Covered<TeamSeasonStatsLine>;
}
