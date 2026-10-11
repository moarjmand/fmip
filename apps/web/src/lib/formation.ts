import type { MatchLineupPlayer } from '@fmip/contracts';

/**
 * Where a side's starters go on the match centre's pitch (T-1384, D-202),
 * from the line-up data the API already returns and nothing else: the
 * formation string ("4-3-3") and each starter's role (goalkeeper, defender,
 * midfielder, forward). No grid position is stored, so the pitch is drawn only
 * where those two facts place every starter on exactly one line:
 *
 * - eleven starters, each with a role, one of them the goalkeeper;
 * - a formation of outfield lines that adds up to ten;
 * - one midfield line (4-3-3, 4-4-2, 3-5-2, 5-3-2, 3-4-3, 5-4-1, 4-5-1), so
 *   the defenders fill the first line, the midfielders the middle one and the
 *   forwards the last, and each count matches its line.
 *
 * Anything else is a list with the reason said (rule 3): a formation with two
 * midfield lines (4-2-3-1) would need to know which midfielder stood in
 * which, and the feed does not say, so placing them would invent positions.
 * Across a line the order is the shirt number's (the API's order), which the
 * page says, because the feed does not give left from right either.
 */

export type PitchRole = NonNullable<MatchLineupPlayer['position']>;

export type PitchLines =
  | {
      state: 'pitch';
      /** The formation as supplied, for the heading. */
      formation: string;
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
    formation: shape,
    lines: [keepers, defenders, midfielders, forwards],
  };
}
