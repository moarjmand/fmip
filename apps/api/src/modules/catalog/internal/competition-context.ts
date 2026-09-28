import type {
  CompetitionContext,
  CompetitionContextTable,
  ContextStanding,
  CoverageState,
  Covered,
  TableRow,
} from '@fmip/contracts';

/**
 * The match centre's competition context (T-840, blueprint 4.2), the pure
 * half: which part of the competition a match belongs to, and a side's line
 * in a table with the gaps our records can state. Tested without a database.
 */

/** What the context of a match is built from. */
export type Phase =
  | { kind: 'league' }
  | { kind: 'group'; stageId: string | null; groupName: string | null }
  | { kind: 'knockout' }
  | { kind: 'none' };

export interface PhaseInput {
  competitionKind: CompetitionContext['competition']['kind'];
  stage: { id: string; kind: string } | null;
  round: string | null;
  groupName: string | null;
}

/**
 * The stage's kind when our records name one; without a stage row, a league
 * competition's match is a league match, and a cup's is read from the
 * round's words the way the adapters read them ("Group B - 2", "League Stage
 * - 1", "Round of 16"). A friendly has no competition context.
 */
export function phaseOf(input: PhaseInput): Phase {
  if (input.competitionKind === 'friendly') return { kind: 'none' };
  const kind = input.stage?.kind ?? kindFromWords(input.competitionKind, input.round);
  switch (kind) {
    case 'league':
      return { kind: 'league' };
    case 'group':
      return { kind: 'group', stageId: input.stage?.id ?? null, groupName: input.groupName };
    case 'knockout':
    case 'playoff':
    case 'qualifying':
      return { kind: 'knockout' };
    default:
      return { kind: 'none' };
  }
}

function kindFromWords(
  competitionKind: PhaseInput['competitionKind'],
  round: string | null,
): string {
  if (competitionKind === 'league') return 'league';
  const r = (round ?? '').toLowerCase();
  if (r.includes('regular season') || /^league (stage|phase)/.test(r)) return 'league';
  if (r.includes('group')) return 'group';
  // A cup, a super cup or a qualifying competition: every other match is a tie.
  return 'knockout';
}

/**
 * A side's line in a ranked table, with the gaps the table itself supports:
 * to first place, to the place above and over the place below. Null when the
 * side is not in the table.
 */
export function standingOf(rows: readonly TableRow[], teamId: string): ContextStanding | null {
  const index = rows.findIndex((r) => r.team.id === teamId);
  if (index < 0) return null;
  const row = rows[index]!;
  const above = index > 0 ? rows[index - 1]! : null;
  const below = index < rows.length - 1 ? rows[index + 1]! : null;
  return {
    team: row.team,
    position: row.position,
    played: row.played,
    won: row.won,
    drawn: row.drawn,
    lost: row.lost,
    goal_difference: row.goal_difference,
    points: row.points,
    form: row.form,
    points_from_top: rows[0]!.points - row.points,
    points_to_place_above: above === null ? null : above.points - row.points,
    points_clear_of_place_below: below === null ? null : row.points - below.points,
  };
}

/**
 * The table module of the context. A table with no finished match before
 * kick-off has no positions: under a season that declares its standings it
 * says so with `matches_counted` 0; otherwise it is the table's own absence.
 * A side missing from a table that has rows makes the module `limited`.
 */
export function contextTable(
  before: {
    table: Covered<TableRow[]>;
    counted: number;
    teams: number;
    declared: CoverageState | null;
  },
  scope: CompetitionContextTable['scope'],
  groupName: string | null,
  homeId: string,
  awayId: string,
): Covered<CompetitionContextTable> {
  const { table } = before;
  const empty = {
    scope,
    group_name: groupName,
    places: 'not_supplied' as const,
  };
  if (before.counted === 0) {
    if (before.declared === 'available' || before.declared === 'limited') {
      return {
        coverage: before.declared,
        last_updated_at: table.last_updated_at,
        data: {
          ...empty,
          matches_counted: 0,
          teams: before.teams,
          leader: null,
          home: null,
          away: null,
        },
      };
    }
    return { coverage: table.coverage, last_updated_at: table.last_updated_at, data: null };
  }
  const rows = table.data;
  if (rows === null || rows.length === 0) {
    return { coverage: table.coverage, last_updated_at: table.last_updated_at, data: null };
  }
  const home = standingOf(rows, homeId);
  const away = standingOf(rows, awayId);
  return {
    coverage: home === null || away === null ? 'limited' : table.coverage,
    last_updated_at: table.last_updated_at,
    data: {
      ...empty,
      matches_counted: before.counted,
      teams: rows.length,
      leader: { team: rows[0]!.team, points: rows[0]!.points },
      home,
      away,
    },
  };
}
