/**
 * The pure half of localised names on every surface (T-1312): find the named
 * entities in an answer, and put the reader's names into a copy of it.
 *
 * Every contract names a team, a competition, a country or a person the same
 * way -- an object with the entity's UUID as `id` and its name as `name`
 * (`ScoreCardTeam`, a table row's `team`, a group's `competition`, a
 * search result). So one walk over the answer finds them all, and the names
 * come from one set-based query for the whole answer, whatever the endpoint.
 * Rule 1 holds: an entity is found by its UUID, never by its name.
 *
 * An object that already carries `localised_name` (the team, competition and
 * player pages' own entity, T-303; a news chip) is left as it is: its `name`
 * is the canonical one by contract, and the page shows the two side by side.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Named = { id: string; name: string } & Record<string, unknown>;

function isPlain(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

function isNamed(value: Record<string, unknown>): value is Named {
  return (
    typeof value.id === 'string' &&
    UUID.test(value.id) &&
    typeof value.name === 'string' &&
    !('localised_name' in value)
  );
}

/** The ids of every named entity in `payload`, lower-cased and once each. */
export function namedIds(payload: unknown): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (!isPlain(value)) return;
    if (isNamed(value)) ids.add(value.id.toLowerCase());
    for (const key of Object.keys(value)) visit(value[key]);
  };
  visit(payload);
  return [...ids];
}

/**
 * A copy of `payload` with each named entity's `name` replaced by the
 * reader's, where `names` has one. The answer itself is never changed: the
 * same object may be a snapshot shared by every open stream (T-032), in
 * every language.
 *
 * Where a name is replaced, an English `short_name` ("Man Utd") would sit in
 * front of it on every card that prefers the short form, so it becomes
 * `null` -- "no short form in this language" -- and the card falls back to
 * the reader's full name.
 */
export function withNames<T>(payload: T, names: ReadonlyMap<string, string>): T {
  if (names.size === 0) return payload;
  const copy = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(copy);
    if (!isPlain(value)) return value;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value)) out[key] = copy(value[key]);
    if (isNamed(value)) {
      const name = names.get(value.id.toLowerCase());
      if (name !== undefined) {
        out.name = name;
        if (typeof value.short_name === 'string') out.short_name = null;
      }
    }
    return out;
  };
  return copy(payload) as T;
}
