import type { MatchLineupPlayer } from '@fmip/contracts';

/**
 * Where a side's starters go on the match centre's pitch (T-1384, D-202;
 * T-1397, D-212), from the line-up data the API returns and nothing else.
 *
 * First choice, any formation (`gridLines`): every starter's `grid`, the
 * place the line-up gives him -- `row` the line from the goalkeeper's (1)
 * towards the halfway line, `col` across the line from the side's own left as
 * it attacks (1). It is used only when it is whole:
 *
 * - eleven starters, each with a place, no place given twice;
 * - one player alone on row 1, and he is the goalkeeper when a role is given;
 * - when a formation is supplied, the lines after the goalkeeper's hold its
 *   counts (a 4-2-3-1 is four, two, three and one).
 *
 * Otherwise (`pitchLines`), the formation string ("4-3-3") and each
 * starter's role (goalkeeper, defender, midfielder, forward) place a side
 * only where they put every starter on exactly one line:
 *
 * - eleven starters, each with a role, one of them the goalkeeper;
 * - a formation of outfield lines that adds up to ten;
 * - one midfield line (4-3-3, 4-4-2, 3-5-2, 5-3-2, 3-4-3, 5-4-1, 4-5-1), so
 *   the defenders fill the first line, the midfielders the middle one and the
 *   forwards the last, and each count matches its line.
 *
 * Anything else is a list with the reason said (rule 3): a formation with two
 * midfield lines (4-2-3-1) and no places would need to know which midfielder
 * stood in which line, and placing them would invent positions. Placed by
 * roles, the order across a line is the shirt number's (the API's order),
 * which the page says, because then the feed does not give left from right.
 */

export type PitchRole = NonNullable<MatchLineupPlayer['position']>;

export type PitchLines =
  | {
      state: 'pitch';
      /**
       * `grid`: each starter at the place the line-up gives him, each line
       * from the side's own left as it attacks. `roles`: by the formation and
       * the roles, each line in shirt-number order.
       */
      by: 'grid' | 'roles';
      /** The formation as supplied, for the heading; null when none is. */
      formation: string | null;
      /** Goalkeeper first, then each outfield line towards the halfway line. */
      lines: MatchLineupPlayer[][];
    }
  | { state: 'no_formation' }
  | { state: 'no_roles' }
  | { state: 'lines_unknown'; formation: string }
  | { state: 'mismatch'; formation: string };

/** Three to five outfield lines, each of one to nine players: "4-3-3", "3-4-2-1". */
const FORMATION = /^[1-9](?:-[1-9]){2,4}$/;

export function pitchLines(formation: string | null, players: MatchLineupPlayer[]): PitchLines {
  const starters = players.filter((p) => p.role === 'starter');
  const shape = formation?.trim() ?? '';
  if (shape === '' || !FORMATION.test(shape)) return { state: 'no_formation' };
  const counts = shape.split('-').map(Number);
  if (starters.length !== 11 || starters.some((p) => p.position === null)) {
    return { state: 'no_roles' };
  }
  const by = (role: PitchRole) => starters.filter((p) => p.position === role);
  const keepers = by('goalkeeper');
  const defenders = by('defender');
  const midfielders = by('midfielder');
  const forwards = by('forward');
  if (counts.reduce((a, b) => a + b, 0) !== 10 || keepers.length !== 1) {
    return { state: 'mismatch', formation: shape };
  }
  if (counts.length > 3) return { state: 'lines_unknown', formation: shape };
  const [back, middle, front] = counts;
  if (defenders.length !== back || midfielders.length !== middle || forwards.length !== front) {
    return { state: 'mismatch', formation: shape };
  }
  return {
    state: 'pitch',
    by: 'roles',
    formation: shape,
    lines: [keepers, defenders, midfielders, forwards],
  };
}

/**
 * The starters by the places the line-up gives them, or null when those
 * places are not whole (see above): goalkeeper's line first, each line from
 * the side's own left as it attacks.
 */
export function gridLines(
  formation: string | null,
  players: MatchLineupPlayer[],
): Extract<PitchLines, { state: 'pitch' }> | null {
  const starters = players.filter((p) => p.role === 'starter');
  if (starters.length !== 11) return null;
  const rows = new Map<number, MatchLineupPlayer[]>();
  const taken = new Set<string>();
  for (const p of starters) {
    const grid = p.grid;
    // A line-up from before places were kept may lack the field altogether.
    if (grid === null || grid === undefined) return null;
    if (!Number.isInteger(grid.row) || !Number.isInteger(grid.col)) return null;
    if (grid.row < 1 || grid.col < 1) return null;
    const cell = `${grid.row}:${grid.col}`;
    if (taken.has(cell)) return null;
    taken.add(cell);
    rows.set(grid.row, [...(rows.get(grid.row) ?? []), p]);
  }
  const lines = [...rows.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, line]) => line.sort((a, b) => (a.grid?.col ?? 0) - (b.grid?.col ?? 0)));
  const [keeperLine, ...outfield] = lines;
  if (keeperLine === undefined || keeperLine[0]?.grid?.row !== 1 || keeperLine.length !== 1) {
    return null;
  }
  const keeper = keeperLine[0];
  if (keeper.position !== null && keeper.position !== 'goalkeeper') return null;
  const shape = formation?.trim() ?? '';
  const supplied = FORMATION.test(shape) ? shape : null;
  if (supplied !== null && supplied !== outfield.map((line) => line.length).join('-')) return null;
  return { state: 'pitch', by: 'grid', formation: supplied, lines };
}

/** The places when they are whole, else the formation and the roles. */
export function pitchShape(formation: string | null, players: MatchLineupPlayer[]): PitchLines {
  return gridLines(formation, players) ?? pitchLines(formation, players);
}
