/**
 * A group's own name from the label a provider gives one of its tables
 * (T-1333): "Group A" → "A", "League A - Group 1" → "1", "GROUP_B" read as
 * "Group B" → "B". This is what `fixture.group_name` stores and what a page
 * reads as "Group {name}"; the stage ("League A") is the fixture's stage, not
 * part of the group's name.
 *
 * Null for a label that does not end in a group: the one table of a league
 * (its label is the league's name), a conference or a split of a league
 * ("Eastern Conference", "Championship Round"), or "Group Stage" itself. A
 * table with no group is compared with the league table, as before; a group
 * is never guessed from anything else (rule 3).
 */
export function groupOfLabel(label: string | null): string | null {
  if (label === null) return null;
  const match = /(?:^|[\s,\-_])group[\s_]+([a-z0-9]{1,3})\s*$/i.exec(label.trim());
  return match?.[1]?.toUpperCase() ?? null;
}
