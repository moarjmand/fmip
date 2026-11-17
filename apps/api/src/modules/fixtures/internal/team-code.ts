/**
 * A team's short code as the scores list and the match centre give it
 * (T-1858): the team's own `code` where it has one (clubs: LIV, MUN), else,
 * for a national team only, its country's `code` -- the FIFA trigram every
 * `country` row is keyed by (the catalog migration, T-040's 211 member
 * associations): FRA and TUR, GER rather than ISO's DEU, ENG, SCO, WAL and
 * NIR where ISO has no code at all. Found through `team.country_id`, never
 * by a name (rule 1). A club without a code stays without one: a club's
 * country is where it plays, not what it is called. No code anywhere keeps
 * the readers' fallback (the social card's two initials).
 */
export function teamCodeSql(team: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(team)) throw new Error(`not a table alias: ${team}`);
  return `COALESCE(${team}.code,
                   (SELECT tc.code FROM country tc
                     WHERE tc.id = ${team}.country_id AND ${team}.kind = 'national'))`;
}
