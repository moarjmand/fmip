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
  const match = GROUP_SUFFIX.exec(label.trim());
  return match?.[1]?.toUpperCase() ?? null;
}

const GROUP_SUFFIX = /(?:^|[\s,\-_])group[\s_]+([a-z0-9]{1,3})\s*$/i;

/**
 * The stage a group table's label names before its group (T-1399, D-214):
 * "Apertura - Group A" → "Apertura", "League A - Group 1" and "League A,
 * Group 2" → "League A". Argentina's Liga Profesional has a group A in both
 * its Apertura and its Clausura, and only this tells the two apart.
 *
 * Null when the label names no stage ("Group A") or is not a group's at all
 * (`groupOfLabel` is null): a table is then compared across the season, as
 * before. The name is the stage's as the adapter reads it from a round
 * ("Apertura - 1" → "Apertura"), so it is looked up among the season's stages
 * by name, never guessed.
 */
export function stageOfLabel(label: string | null): string | null {
  if (label === null) return null;
  const trimmed = label.trim();
  const match = GROUP_SUFFIX.exec(trimmed);
  if (match === null) return null;
  const stage = trimmed
    .slice(0, match.index)
    .replace(/[\s,\-_]+$/, '')
    .trim();
  return stage === '' ? null : stage;
}
