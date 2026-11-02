/**
 * Labels a feed prints in a line-up slot in place of a player's name (T-1707,
 * D-342): "Trialist" for a club's unnamed trialist, "Unknown", "TBA" and the
 * like. Such a label names nobody, so it is never a person: a provider that
 * gives the slot an id gives every trialist of every club the same id, and
 * resolving it made one "Trialist" who played for both sides of six Scottish
 * League Cup matches (aud-2026-11-02-01, rule 1).
 *
 * Kept small and exact on purpose: a whole name compared after trimming,
 * folding case and collapsing spaces, never a word inside a name -- "Ali
 * Unknown" or "Tbaraki" stay people. Migration
 * `1765900600000_placeholder-lineup-persons.sql` repeats this list for the
 * rows stored before the check; change both together.
 */
export const PLACEHOLDER_PERSON_NAMES: readonly string[] = [
  'trialist',
  'unknown',
  'unknown player',
  'tba',
  'tbc',
  'tbd',
  'n/a',
  '-',
  '?',
];

const PLACEHOLDERS = new Set(PLACEHOLDER_PERSON_NAMES);

/** True when `name` is empty or one of the labels above, not a person's name. */
export function isPlaceholderPersonName(name: string | null | undefined): boolean {
  if (name === null || name === undefined) return true;
  const folded = name.trim().replace(/\s+/g, ' ').toLowerCase();
  return folded === '' || PLACEHOLDERS.has(folded);
}
