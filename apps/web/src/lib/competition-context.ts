import type {
  CompetitionContext,
  CompetitionContextTable,
  CompetitionContextTie,
  ContextStanding,
} from '@fmip/contracts';
import { ROUND_LABEL, tieOutcome } from '@/lib/bracket';

/**
 * The words of the match centre's competition context (T-840). Pure, so what
 * a reader is told -- and what they are told is not known -- is one tested
 * place.
 */

/** "1st", "2nd", "3rd", "11th", "22nd". */
export function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  switch (n % 10) {
    case 1:
      return `${n}st`;
    case 2:
      return `${n}nd`;
    case 3:
      return `${n}rd`;
    default:
      return `${n}th`;
  }
}

const pts = (n: number) => `${n} ${n === 1 ? 'pt' : 'pts'}`;

/** "2nd of 20 · 31 pts from 14 played". */
export function positionLine(side: ContextStanding, teams: number): string {
  return `${ordinal(side.position)} of ${teams} · ${pts(side.points)} from ${side.played} played`;
}

/** The gaps the table supports: to first, to the place above, over the place below. */
export function gapLines(side: ContextStanding): string[] {
  const lines: string[] = [];
  if (side.position === 1) {
    lines.push(
      side.points_clear_of_place_below === null
        ? 'First'
        : `First, ${pts(side.points_clear_of_place_below)} clear of second`,
    );
    return lines;
  }
  lines.push(`${pts(side.points_from_top)} behind first`);
  if (side.points_to_place_above !== null) {
    lines.push(
      side.points_to_place_above === 0
        ? 'Level on points with the place above'
        : `${pts(side.points_to_place_above)} behind the place above`,
    );
  }
  if (side.points_clear_of_place_below !== null) {
    lines.push(
      side.points_clear_of_place_below === 0
        ? 'Level on points with the place below'
        : `${pts(side.points_clear_of_place_below)} clear of the place below`,
    );
  }
  return lines;
}

/** What the table is and how much of it there is. */
export function tableHeading(table: CompetitionContextTable): string {
  return table.scope === 'group' && table.group_name !== null
    ? `Group ${table.group_name}, before kick-off`
    : 'League table, before kick-off';
}

export function countedLine(table: CompetitionContextTable): string {
  if (table.matches_counted === 0) {
    return 'No match of this table was played before this one, so there are no positions yet.';
  }
  return `From the ${table.matches_counted} finished ${table.matches_counted === 1 ? 'match' : 'matches'} of this table played before kick-off.`;
}

/**
 * Said under every table: the places are not in our records, so no gap to
 * them is given (rule 3).
 */
export const PLACES_NOTE =
  'Where the qualification, promotion and relegation places fall is not in our records, so no gap to them is shown.';

/** The round in words: the UEFA round when known, else the competition's own. */
export function roundName(tie: CompetitionContextTie): string {
  return tie.round_key !== null ? ROUND_LABEL[tie.round_key] : (tie.round ?? 'Knockout round');
}

/** "Two legs", "One match", or what our records cannot say. */
export function legsNote(tie: CompetitionContextTie): string {
  if (tie.legs_expected === 2) return 'Two legs';
  if (tie.legs_expected === 1) return 'One match';
  return 'Whether this round has a second leg is not in our records';
}

/** The tie's outcome line, or nothing judged when the legs are unknown. */
export function tieLine(tie: CompetitionContextTie): string {
  if (tie.legs_expected === null) return 'Not judged: the number of legs is not in our records.';
  return tieOutcome(tie.tie, tie.legs_expected);
}

/** The sentence for a match with neither a table nor a tie to show. */
export function absenceLine(context: CompetitionContext): string {
  if (context.table !== null && context.table.coverage === 'delayed') {
    return 'The table for this competition is delayed.';
  }
  if (context.table !== null) {
    return 'No table from before this match is in our records.';
  }
  return context.competition.kind === 'friendly'
    ? 'A friendly: no table or round to place it in.'
    : 'Neither a table nor a knockout round for this match is in our records.';
}
