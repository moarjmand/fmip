/**
 * League zones (T-1167, D-171): the qualification and relegation places of a
 * league season, from a committed list -- `zones/league-zones.json`, read as
 * `@fmip/contracts/zones/league-zones.json` by the API and by the model
 * service. One entry per competition and season, keyed by the competition's
 * training division (`competition.football_data_division`: E0, SP1, IR1 ...,
 * our code, never a name -- rule 1) and the season's label (`2025/26`), each
 * with the published sources it was read from.
 *
 * A league the model does not hold has no training division (T-1444, D-234):
 * its entry is keyed by the competition's country (the FIFA trigram of our
 * `country` table, BEL, SCO, KSA ...) instead, and the lookup falls back to it
 * when the division finds nothing.
 *
 * Only places a league position earns by itself are listed. Europa League
 * and Conference League places (and the AFC's second competition) are not:
 * who takes them depends on the domestic cups, which a table cannot show.
 * A place decided during the season (UEFA's European Performance Spot) is not
 * listed either, since the regulations do not fix it before the season.
 *
 * A competition or season absent from the list shows no zones (rule 3).
 *
 * `afc_champions_league` is the AFC's first club competition until 2023/24;
 * `afc_champions_league_elite` is the one that replaced it from 2024/25. A
 * season is listed under the competition its places went to (T-1659, D-315).
 *
 * A league split into conferences (D-319) ranks each conference on its own,
 * and its places are a conference table's: such a zone names its conference
 * (`conference`, the name the standings job stores in `season_conference`),
 * and the league's one table shows only the zones that name none (T-1674,
 * D-323). `title_playoffs` is a place in the play-offs that decide the
 * champion (MLS's first round); `title_playoffs_wild_card` a place in the
 * round played to reach them.
 *
 * An entry may also say how its league ranks clubs level on points
 * (`ranking`, T-1674, D-323), where that differs from the default
 * (`DEFAULT_RANKING`).
 */
export const LEAGUE_ZONE_KINDS = [
  'champions_league',
  'afc_champions_league',
  'afc_champions_league_elite',
  'copa_libertadores',
  'title_playoffs',
  'title_playoffs_wild_card',
  'promotion',
  'promotion_playoff',
  'relegation_playoff',
  'relegation',
] as const;
export type LeagueZoneKind = (typeof LEAGUE_ZONE_KINDS)[number];

/** A band of places, both ends included, counted from 1. */
export interface LeagueZone {
  kind: LeagueZoneKind;
  from: number;
  to: number;
  /**
   * The conference whose table the places are of (T-1674, D-323), as
   * `season_conference.name` spells it ("Eastern Conference"); absent for a
   * place in the league's one table.
   */
  conference?: string;
}

/**
 * What a league table ranks clubs by, in order (T-1674, D-323). Clubs level
 * on every criterion are listed by name, as in every table (D-038).
 */
export const TABLE_CRITERIA = ['points', 'wins', 'goal_difference', 'goals_for'] as const;
export type TableCriterion = (typeof TABLE_CRITERIA)[number];

/** Points, then goal difference, then goals scored (D-038): every league without a `ranking`. */
export const DEFAULT_RANKING: readonly TableCriterion[] = [
  'points',
  'goal_difference',
  'goals_for',
];

/** One entry of the committed list. */
export interface LeagueZoneEntry {
  /** The training division (E0, IR1 ...); absent for an entry keyed by `country`. */
  division?: string;
  /**
   * The country's FIFA trigram (`country.code`), for the top-flight league of a
   * country whose league has no training division (D-234). Exactly one of
   * `division` and `country` is set.
   */
  country?: string;
  season: string;
  /** The clubs in the league that season. */
  teams: number;
  zones: LeagueZone[];
  /**
   * Every place a league position earns by itself is listed. `false` when the
   * season's continental places are not published yet: the table shows what
   * is listed and says the rest is not, and the model's zone-aware stakes do
   * not read the season.
   */
  complete: boolean;
  /** The published regulations or reports each place was read from (https). */
  sources: string[];
  /** What a reader should know: a place not listed and why, a changed format. */
  note?: string;
  /** The same note in Persian, for `/fa` (T-1557): every note has one. */
  note_fa?: string;
  /**
   * How the league ranks clubs (T-1674, D-323), starting with points, when it
   * differs from `DEFAULT_RANKING`; the source is among `sources`. It ranks
   * the league's table and its conference tables for this season.
   */
  ranking?: TableCriterion[];
}

/** The competition page's zones for the selected season. */
export type LeagueZones =
  | {
      state: 'listed';
      teams: number;
      zones: LeagueZone[];
      complete: boolean;
      sources: string[];
      note: string | null;
      /** `note` in Persian (T-1557); a page in another language shows `note`. */
      note_fa?: string | null;
    }
  | {
      state: 'not_listed';
      /**
       * `not_a_league`: a cup; `no_division`: the competition has no division
       * and no top-flight country to key on; `season_not_listed`: the list has no entry for it.
       */
      reason: 'not_a_league' | 'no_division' | 'season_not_listed';
    };

/**
 * The competition as the lookup reads it. `country` is the FIFA trigram of a
 * senior men's domestic league and is left null for anything else; `tier` is
 * the catalog's (1 = top flight, null where it is not recorded).
 */
export interface ZoneCompetition {
  kind: string;
  division: string | null;
  country?: string | null;
  tier?: number | null;
}

/**
 * The zones of one season, or why there are none. The division finds an entry
 * first; failing that, the country does, for the top flight only: a catalog
 * that records a tier other than 1 never matches (a null tier is read as the
 * top flight, since every country listed here holds one league).
 */
export function leagueZonesFor(
  entries: readonly LeagueZoneEntry[],
  competition: ZoneCompetition,
  season: string,
): LeagueZones {
  const e = entryFor(entries, competition, season);
  if (typeof e === 'string') return { state: 'not_listed', reason: e };
  return {
    state: 'listed',
    teams: e.teams,
    zones: e.zones,
    complete: e.complete,
    sources: e.sources,
    note: e.note ?? null,
    note_fa: e.note_fa ?? null,
  };
}

/**
 * How a season's tables rank clubs (T-1674, D-323): its entry's `ranking`,
 * else the default. Found by the same keys as its zones.
 */
export function leagueRankingFor(
  entries: readonly LeagueZoneEntry[],
  competition: ZoneCompetition,
  season: string,
): readonly TableCriterion[] {
  const e = entryFor(entries, competition, season);
  return typeof e === 'string' ? DEFAULT_RANKING : (e.ranking ?? DEFAULT_RANKING);
}

/**
 * The zones one table shows (T-1674, D-323): a conference's table the zones
 * naming that conference, the league's one table (`null`) those naming none.
 */
export function zonesOfTable(
  zones: readonly LeagueZone[],
  conference: string | null,
): LeagueZone[] {
  return zones.filter((z) => (z.conference ?? null) === conference);
}

/**
 * The entry for a season, or why there is none. `season` is the stored label
 * (`2026/27`), which a calendar-year season keeps although its pages show
 * the year alone (T-1483, D-256).
 */
function entryFor(
  entries: readonly LeagueZoneEntry[],
  competition: ZoneCompetition,
  season: string,
): LeagueZoneEntry | 'not_a_league' | 'no_division' | 'season_not_listed' {
  if (competition.kind !== 'league') return 'not_a_league';
  const country = competition.country ?? null;
  const topFlight =
    competition.tier === undefined || competition.tier === null || competition.tier === 1;
  // Neither key finds anything in the list for this competition (rule 3).
  if (
    competition.division === null &&
    (country === null || !topFlight || !entries.some((x) => x.country === country))
  )
    return 'no_division';
  return (
    entries.find(
      (x) =>
        competition.division !== null && x.division === competition.division && x.season === season,
    ) ??
    entries.find(
      (x) => country !== null && topFlight && x.country === country && x.season === season,
    ) ??
    'season_not_listed'
  );
}

/** The zone a place falls in, if any. */
export function zoneOfPlace(zones: readonly LeagueZone[], position: number): LeagueZone | null {
  return zones.find((z) => position >= z.from && position <= z.to) ?? null;
}
