import { LEAGUE_ZONE_KINDS, TABLE_CRITERIA, type LeagueZoneEntry } from './league-zones';

/**
 * The checker for the committed list (T-1167, D-171). It lives in a file of its
 * own and is not exported from the package: the web app reads the package as
 * one module, so everything in `league-zones.ts` is in its first-load
 * JavaScript, and only the spec and the build need this.
 */
const SEASON = /^\d{4}\/\d{2}$/;
const DIVISION = /^[A-Z]{1,2}[0-9C]$/;
const COUNTRY = /^[A-Z]{3}$/;
/** Our code for a competition (`competition.zone_key`, T-1761): the migration's format. */
const COMPETITION = /^[A-Z][A-Z0-9_]{1,15}$/;

/** What identifies an entry in messages: its division, its country or its competition code. */
const keyOf = (e: LeagueZoneEntry): string => e.division ?? e.country ?? e.competition ?? '?';

/**
 * Every way the list can be wrong, as sentences; empty when it is sound. A
 * place past the table's size, bands that overlap, a band upside down, a
 * repeated key or a source that is not an https address all fail. Bands of
 * different conferences' tables may share places (T-1674, D-323); a ranking
 * starts with points and names each criterion once; a cup's league phase
 * (`matches`, T-1761) puts every place in a band.
 */
export function leagueZoneProblems(entries: readonly LeagueZoneEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const key = `${keyOf(e)} ${e.season}`;
    const keys = [e.division, e.country, e.competition].filter((k) => k !== undefined);
    if (keys.length !== 1)
      problems.push(`${key}: exactly one of division, country and competition is needed`);
    if (e.division !== undefined && !DIVISION.test(e.division))
      problems.push(`${key}: division is not a code`);
    if (e.country !== undefined && !COUNTRY.test(e.country))
      problems.push(`${key}: country is not a three-letter code`);
    if (e.competition !== undefined && !COMPETITION.test(e.competition))
      problems.push(`${key}: competition is not a code`);
    if (!SEASON.test(e.season)) problems.push(`${key}: season is not a label like 2025/26`);
    if (seen.has(key)) problems.push(`${key}: listed twice`);
    seen.add(key);
    if (!Number.isInteger(e.teams) || e.teams < 2)
      problems.push(`${key}: teams must be at least 2`);
    if (e.sources.length === 0) problems.push(`${key}: no source`);
    for (const s of e.sources) {
      if (!s.startsWith('https://')) problems.push(`${key}: source ${s} is not https`);
    }
    if (e.ranking !== undefined) {
      if (e.ranking[0] !== 'points') problems.push(`${key}: a ranking starts with points`);
      if (new Set(e.ranking).size !== e.ranking.length)
        problems.push(`${key}: a ranking names a criterion twice`);
      for (const c of e.ranking)
        if (!(TABLE_CRITERIA as readonly string[]).includes(c))
          problems.push(`${key}: unknown ranking criterion ${c}`);
    }
    const taken = new Set<string>();
    for (const z of e.zones) {
      if (z.conference !== undefined && z.conference.trim() === '')
        problems.push(`${key}: ${z.kind} names an empty conference`);
      if (!(LEAGUE_ZONE_KINDS as readonly string[]).includes(z.kind))
        problems.push(`${key}: unknown kind ${z.kind}`);
      if (!Number.isInteger(z.from) || !Number.isInteger(z.to) || z.from < 1 || z.to < z.from)
        problems.push(`${key}: ${z.kind} ${z.from}-${z.to} is not a band`);
      if (z.to > e.teams)
        problems.push(`${key}: ${z.kind} reaches place ${z.to} of a ${e.teams}-club table`);
      const table = z.conference === undefined ? '' : ` of the ${z.conference}`;
      for (let p = z.from; p <= z.to; p += 1) {
        if (taken.has(`${table}:${p}`)) problems.push(`${key}: place ${p}${table} is in two zones`);
        taken.add(`${table}:${p}`);
      }
    }
    // A cup's league phase (T-1761, D-381): every place in a band, one table.
    if (e.matches !== undefined) {
      if (!Number.isInteger(e.matches) || e.matches < 1)
        problems.push(`${key}: matches must be a whole number of at least 1`);
      if (e.zones.some((z) => z.conference !== undefined))
        problems.push(`${key}: a league phase is one table, with no conference`);
      for (let p = 1; p <= e.teams; p += 1)
        if (!taken.has(`:${p}`))
          problems.push(`${key}: place ${p} of the league phase is in no band`);
    }
  }
  return problems;
}
