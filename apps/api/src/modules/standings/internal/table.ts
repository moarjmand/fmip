import {
  DEFAULT_RANKING,
  type FormResult,
  type TableCriterion,
  type TableRow,
} from '@fmip/contracts';

/**
 * A league table from finished results (blueprint 5.1), pure so the ranking
 * is tested without a database. Three points for a win, one for a draw;
 * ranked by points, goal difference, goals scored, then name -- the common
 * default. A league that ranks otherwise says so in its season's entry of the
 * committed league list (T-1674, D-323: MLS puts wins after points), and the
 * caller passes that order; the name always comes last.
 */
export interface Result {
  fixtureId: string;
  kickoffAt: string;
  home: { id: string; name: string; shortName: string | null };
  away: { id: string; name: string; shortName: string | null };
  homeGoals: number;
  awayGoals: number;
}

export const FORM_WINDOW = 5;

interface Tally {
  team: TableRow['team'];
  played: number;
  won: number;
  drawn: number;
  lost: number;
  goalsFor: number;
  goalsAgainst: number;
  points: number;
  /** Oldest first while tallying; reversed for the row. */
  form: FormResult[];
}

/** Teams that appear in `participants` but have no finished result yet still get a row. */
export function rankTable(
  results: readonly Result[],
  participants: readonly TableRow['team'][] = [],
  ranking: readonly TableCriterion[] = DEFAULT_RANKING,
): TableRow[] {
  const tallies = new Map<string, Tally>();
  const tally = (team: TableRow['team']): Tally => {
    let t = tallies.get(team.id);
    if (t === undefined) {
      t = {
        team,
        played: 0,
        won: 0,
        drawn: 0,
        lost: 0,
        goalsFor: 0,
        goalsAgainst: 0,
        points: 0,
        form: [],
      };
      tallies.set(team.id, t);
    }
    return t;
  };
  for (const team of participants) tally(team);

  const ordered = [...results].sort(
    (a, b) => a.kickoffAt.localeCompare(b.kickoffAt) || a.fixtureId.localeCompare(b.fixtureId),
  );
  for (const r of ordered) {
    const home = tally({ id: r.home.id, name: r.home.name, short_name: r.home.shortName });
    const away = tally({ id: r.away.id, name: r.away.name, short_name: r.away.shortName });
    apply(home, r.homeGoals, r.awayGoals);
    apply(away, r.awayGoals, r.homeGoals);
  }

  const rows = [...tallies.values()].sort((a, b) => {
    for (const criterion of ranking) {
      const d = CRITERIA[criterion](b) - CRITERIA[criterion](a);
      if (d !== 0) return d;
    }
    return a.team.name.localeCompare(b.team.name);
  });
  return rows.map((t, index) => ({
    position: index + 1,
    team: t.team,
    played: t.played,
    won: t.won,
    drawn: t.drawn,
    lost: t.lost,
    goals_for: t.goalsFor,
    goals_against: t.goalsAgainst,
    goal_difference: t.goalsFor - t.goalsAgainst,
    points: t.points,
    form: t.form.slice(-FORM_WINDOW).reverse(),
  }));
}

/** Each criterion as a number, higher ranking first. */
const CRITERIA: Record<TableCriterion, (t: Tally) => number> = {
  points: (t) => t.points,
  wins: (t) => t.won,
  goal_difference: (t) => t.goalsFor - t.goalsAgainst,
  goals_for: (t) => t.goalsFor,
};

function apply(t: Tally, scored: number, conceded: number): void {
  t.played += 1;
  t.goalsFor += scored;
  t.goalsAgainst += conceded;
  if (scored > conceded) {
    t.won += 1;
    t.points += 3;
    t.form.push('W');
  } else if (scored === conceded) {
    t.drawn += 1;
    t.points += 1;
    t.form.push('D');
  } else {
    t.lost += 1;
    t.form.push('L');
  }
}

/**
 * A group's table (T-1399, D-214): ranked over its results as `rankTable`
 * ranks them, then only the group's own teams kept and numbered. A result
 * against a team of another group (Argentina's interzonal matches) counts
 * for the member who played it; the other side has a row in its own group.
 */
export function rankGroup(
  results: readonly Result[],
  members: readonly TableRow['team'][],
  ranking: readonly TableCriterion[] = DEFAULT_RANKING,
): TableRow[] {
  const ids = new Set(members.map((m) => m.id));
  return rankTable(results, members, ranking)
    .filter((row) => ids.has(row.team.id))
    .map((row, index) => ({ ...row, position: index + 1 }));
}
