/**
 * League zones (T-1167, D-171): the qualification and relegation places of a
 * league season, from a committed list -- `zones/league-zones.json`, read as
 * `@fmip/contracts/zones/league-zones.json` by the API and by the model
 * service. One entry per competition and season, keyed by the competition's
 * training division (`competition.football_data_division`: E0, SP1, IR1 ...,
 * our code, never a name -- rule 1) and the season's label (`2025/26`), each
 * with the published sources it was read from.
 *
 * Only places a league position earns by itself are listed. Europa League
 * and Conference League places (and the AFC's second competition) are not:
 * who takes them depends on the domestic cups, which a table cannot show.
 * A place decided during the season (UEFA's European Performance Spot) is not
 * listed either, since the regulations do not fix it before the season.
 *
 * A competition or season absent from the list shows no zones (rule 3).
 */
export const LEAGUE_ZONE_KINDS = [
  'champions_league',
  'afc_champions_league_elite',
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
}

/** One entry of the committed list. */
export interface LeagueZoneEntry {
  division: string;
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
    }
  | {
      state: 'not_listed';
      /**
       * `not_a_league`: a cup; `no_division`: the competition has no code in
       * the list's key; `season_not_listed`: the list has no entry for it.
       */
      reason: 'not_a_league' | 'no_division' | 'season_not_listed';
    };

const SEASON = /^\d{4}\/\d{2}$/;
const DIVISION = /^[A-Z]{1,2}[0-9C]$/;

/**
 * Every way the list can be wrong, as sentences; empty when it is sound. A
 * place past the table's size, bands that overlap, a band upside down, a
 * repeated key or a source that is not an https address all fail.
 */
export function leagueZoneProblems(entries: readonly LeagueZoneEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const key = `${e.division} ${e.season}`;
    if (!DIVISION.test(e.division)) problems.push(`${key}: division is not a code`);
    if (!SEASON.test(e.season)) problems.push(`${key}: season is not a label like 2025/26`);
    if (seen.has(key)) problems.push(`${key}: listed twice`);
    seen.add(key);
    if (!Number.isInteger(e.teams) || e.teams < 2)
      problems.push(`${key}: teams must be at least 2`);
    if (e.sources.length === 0) problems.push(`${key}: no source`);
    for (const s of e.sources) {
      if (!s.startsWith('https://')) problems.push(`${key}: source ${s} is not https`);
    }
    const taken = new Set<number>();
    for (const z of e.zones) {
      if (!(LEAGUE_ZONE_KINDS as readonly string[]).includes(z.kind))
        problems.push(`${key}: unknown kind ${z.kind}`);
      if (!Number.isInteger(z.from) || !Number.isInteger(z.to) || z.from < 1 || z.to < z.from)
        problems.push(`${key}: ${z.kind} ${z.from}-${z.to} is not a band`);
      if (z.to > e.teams)
        problems.push(`${key}: ${z.kind} reaches place ${z.to} of a ${e.teams}-club table`);
      for (let p = z.from; p <= z.to; p += 1) {
        if (taken.has(p)) problems.push(`${key}: place ${p} is in two zones`);
        taken.add(p);
      }
    }
  }
  return problems;
}

/** The zones of one season, or why there are none. */
export function leagueZonesFor(
  entries: readonly LeagueZoneEntry[],
  competition: { kind: string; division: string | null },
  season: string,
): LeagueZones {
  if (competition.kind !== 'league') return { state: 'not_listed', reason: 'not_a_league' };
  if (competition.division === null) return { state: 'not_listed', reason: 'no_division' };
  const e = entries.find((x) => x.division === competition.division && x.season === season);
  if (e === undefined) return { state: 'not_listed', reason: 'season_not_listed' };
  return {
    state: 'listed',
    teams: e.teams,
    zones: e.zones,
    complete: e.complete,
    sources: e.sources,
    note: e.note ?? null,
  };
}

/** The zone a place falls in, if any. */
export function zoneOfPlace(zones: readonly LeagueZone[], position: number): LeagueZone | null {
  return zones.find((z) => position >= z.from && position <= z.to) ?? null;
}
