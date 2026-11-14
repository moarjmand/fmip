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

/**
 * Each team's matches played in our table of the provider's group (T-1399):
 * our groups with that name, in the stage the provider's table names when it
 * names one we hold. Without one, every stage's group of that name is read,
 * as before T-1399 -- one stage's group A is then the only group A there is.
 * A team in no group of ours has no entry.
 */
export function groupPlayed(
  ours: readonly {
    stageId: string;
    name: string;
    rows: readonly { team: { id: string }; played: number }[];
  }[],
  table: { group: string | null; stageId: string | null },
): Map<string, number> {
  return new Map(
    ours
      .filter(
        (g) => g.name === table.group && (table.stageId === null || g.stageId === table.stageId),
      )
      .flatMap((g) => g.rows.map((r) => [r.team.id, r.played] as const)),
  );
}

/**
 * Whether a provider's table that names no group and no conference is the sum
 * of the season's group stages, and so has nothing of ours to be compared with
 * (T-1822, D-416).
 *
 * Argentina's Liga Profesional is played as two group stages (Apertura and
 * Clausura) and no league stage. After the Clausura the feed added a 30-row
 * table with no group whose `played` is each club's 16 + 16 group matches, and
 * the comparison read it against our league table -- empty for a season with
 * no league stage -- so every club became a `table_disagrees` finding ("ours
 * has no row"). The table is left out only when all three hold:
 *
 *   1. our league table for the season is empty (`leagueTable`);
 *   2. the season has group stages with finished matches stored (`ourGroups`);
 *   3. each of the table's teams has played exactly its total of finished
 *      matches over our group stages (a team's interzonal matches are in its
 *      group's table, T-1399).
 *
 * The third is what keeps it from being blind: a sum that does not match ours
 * (a result we do not hold) is compared, and raises its finding -- against
 * our group-stage totals (`groupStagesPlayed`), so only the clubs that differ
 * are named, with our count, not all thirty as "no row" (T-1822 review).
 * Recognised by these facts, never by the competition's name. Pure.
 */
export function isGroupStagesAggregate(
  rows: readonly { teamId: string; played: number }[],
  leagueTable: ReadonlyMap<string, number>,
  ourGroups: readonly { rows: readonly { team: { id: string }; played: number }[] }[],
): boolean {
  if (rows.length === 0) return false;
  const totals = groupStagesPlayed(leagueTable, ourGroups);
  return totals !== null && rows.every((row) => totals.get(row.teamId) === row.played);
}

/**
 * Each team's finished matches over the season's group stages, when the
 * season has no league table of ours and its group stages have finished
 * matches (conditions 1 and 2 of `isGroupStagesAggregate`); `null` otherwise.
 * What a provider table with no group and no conference is compared with in
 * such a season (T-1822). Pure.
 */
export function groupStagesPlayed(
  leagueTable: ReadonlyMap<string, number>,
  ourGroups: readonly { rows: readonly { team: { id: string }; played: number }[] }[],
): Map<string, number> | null {
  if (leagueTable.size > 0) return null;
  const totals = new Map<string, number>();
  let counted = 0;
  for (const group of ourGroups) {
    for (const row of group.rows) {
      totals.set(row.team.id, (totals.get(row.team.id) ?? 0) + row.played);
      counted += row.played;
    }
  }
  return counted === 0 ? null : totals;
}
