/**
 * A team's, competition's or venue's name as a provider wrote it, made tidy
 * (T-1711): leading and trailing whitespace dropped, runs of whitespace inside
 * collapsed to one space. `null` for anything that is not a string or is
 * blank.
 *
 * API-Football sent " Johnstone Burgh" and " Kahramanmaraş İstiklal Spor"
 * with a leading space, and the space reached the team row and the team
 * page's title (str-2026-11-02-02). The name is never a key (rule 1), so
 * tidying it changes what a page prints and nothing it is matched by.
 */
export function entityName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const name = value.replace(/\s+/g, ' ').trim();
  return name === '' ? null : name;
}
