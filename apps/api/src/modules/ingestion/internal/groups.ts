/**
 * Which group each team is in, from the provider's group tables (T-1333).
 *
 * The provider's fixtures do not say a match's group: their round is "Group
 * A - 1" for some competitions and "League A - 1" for the Nations League,
 * whose groups ("League A - Group 1") are named only in its tables. Its
 * tables name every group's teams, so a group-stage match's group is the one
 * both its teams are in (`IngestStore.assignGroups`).
 *
 * A team the tables put in two different groups is in neither here: one of
 * the two is wrong and nothing says which, so its matches keep the group they
 * have rather than one picked at random. Tables with no group are not read.
 */
export function groupMembers(
  tables: readonly { group: string | null; teamIds: readonly string[] }[],
): { teamId: string; group: string }[] {
  const groupOf = new Map<string, string | null>();
  for (const table of tables) {
    if (table.group === null) continue;
    for (const teamId of table.teamIds) {
      const held = groupOf.get(teamId);
      groupOf.set(teamId, held === undefined || held === table.group ? table.group : null);
    }
  }
  return [...groupOf]
    .filter((entry): entry is [string, string] => entry[1] !== null)
    .map(([teamId, group]) => ({ teamId, group }));
}
