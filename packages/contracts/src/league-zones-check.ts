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

/** What identifies an entry in messages: its division or its country. */
const keyOf = (e: LeagueZoneEntry): string => e.division ?? `${e.country ?? '?'}`;

/**
 * Every way the list can be wrong, as sentences; empty when it is sound. A
 * place past the table's size, bands that overlap, a band upside down, a
 * repeated key or a source that is not an https address all fail. Bands of
 * different conferences' tables may share places (T-1674, D-323); a ranking
 * starts with points and names each criterion once.
 */
export function leagueZoneProblems(entries: readonly LeagueZoneEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    const key = `${keyOf(e)} ${e.season}`;
    if ((e.division === undefined) === (e.country === undefined))
      problems.push(`${key}: exactly one of division and country is needed`);
    if (e.division !== undefined && !DIVISION.test(e.division))
      problems.push(`${key}: division is not a code`);
    if (e.country !== undefined && !COUNTRY.test(e.country))
      problems.push(`${key}: country is not a three-letter code`);
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
  }
  return problems;
}
