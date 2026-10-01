import { Injectable } from '@nestjs/common';
import type { CoverageState, Covered, TableRow } from '@fmip/contracts';
import { covered } from '../fixtures/fixtures.service';
import { PostgresStandingsStore, type BoardRow, type Scorer } from './internal/standings-store';
import { rankTable } from './internal/table';

// The module's public surface. Other modules import from this file only.
export { FORM_WINDOW, rankTable, type Result } from './internal/table';
export type { BoardRow, Scorer } from './internal/standings-store';

/** The boards beyond goals as the standings boundary knows them (T-943): no minutes yet. */
export interface Boards {
  assists: Covered<BoardRow<{ assists: number }>[]>;
  clean_sheets: Covered<BoardRow<{ clean_sheets: number; starts_in_goal: number }>[]>;
  cards: Covered<BoardRow<{ yellow_cards: number; red_cards: number }>[]>;
}

export const LEADERS_LIMIT = 10;

/**
 * The standings boundary (02-architecture.md, T-035): league tables and
 * statistical leaders computed from the results and incidents the fixtures
 * boundary stores (D-038). Each answer carries the season's declared coverage
 * for its module, so an empty table is `not_supplied`, never a blank grid.
 */
@Injectable()
export class StandingsService {
  constructor(private readonly store: PostgresStandingsStore) {}

  /** The league table of a season's league stage, or the honest absence of one. */
  async table(seasonId: string): Promise<Covered<TableRow[]>> {
    const [{ results, lastUpdatedAt }, participants, declared] = await Promise.all([
      this.store.leagueResults(seasonId),
      this.store.leagueParticipants(seasonId),
      this.store.declared(seasonId, 'standings'),
    ]);
    const rows = results.length === 0 ? [] : rankTable(results, participants);
    return covered(rows, rows.length === 0, declared, lastUpdatedAt);
  }

  /**
   * Every group table of a season's group stages as it stands (T-1333), each
   * group ranked on its own; the standings job compares the provider's group
   * tables with these, row by row. Empty when no fixture carries a group.
   */
  async groupTables(
    seasonId: string,
  ): Promise<{ stageId: string; name: string; rows: TableRow[] }[]> {
    const groups = await this.store.seasonGroups(seasonId);
    return Promise.all(
      groups.map(async (group) => {
        const [{ results }, participants] = await Promise.all([
          this.store.groupResults(group.stageId, group.name, null),
          this.store.groupParticipants(group.stageId, group.name),
        ]);
        return { ...group, rows: rankTable(results, participants) };
      }),
    );
  }

  /**
   * A table as it stood before `before` (T-840): the season's league stage,
   * or one group of a group stage. `counted` is how many finished matches it
   * is built from; with none, there are no positions yet and `data` is null
   * under the declared state rather than a grid of noughts ordered by name.
   */
  async tableBefore(
    seasonId: string,
    before: string,
    group: { stageId: string; name: string } | null = null,
  ): Promise<{
    table: Covered<TableRow[]>;
    counted: number;
    teams: number;
    declared: CoverageState | null;
  }> {
    const [{ results, lastUpdatedAt }, participants, declared] = await Promise.all([
      group === null
        ? this.store.leagueResults(seasonId, before)
        : this.store.groupResults(group.stageId, group.name, before),
      group === null
        ? this.store.leagueParticipants(seasonId)
        : this.store.groupParticipants(group.stageId, group.name),
      this.store.declared(seasonId, 'standings'),
    ]);
    const rows = results.length === 0 ? [] : rankTable(results, participants);
    return {
      table: covered(rows, rows.length === 0, declared, lastUpdatedAt),
      counted: results.length,
      teams: participants.length,
      declared,
    };
  }

  /** Top goalscorers of a season from recorded goal incidents; every scorer when `limit` is null. */
  async leaders(
    seasonId: string,
    limit: number | null = LEADERS_LIMIT,
  ): Promise<Covered<Scorer[]>> {
    const [{ leaders, lastUpdatedAt }, declared] = await Promise.all([
      this.store.scorers(seasonId, limit),
      this.store.declared(seasonId, 'incidents'),
    ]);
    return covered(leaders, leaders.length === 0, declared, lastUpdatedAt);
  }

  /**
   * Assists, clean sheets and cards for a season (T-943, D-118), every row,
   * each its own module:
   *
   * - assists under the declared `incidents` state; `not_supplied` when the
   *   season's goals name no assist at all, since a list of nobody would
   *   read as a season without assists;
   * - cards under the declared `incidents` state;
   * - clean sheets under the declared `lineups` state, `limited` when some
   *   finished sides could not be judged (no line-up naming one starting
   *   goalkeeper), and `not_supplied` when none could. A season where every
   *   judged keeper conceded is an empty list, not an absence.
   */
  async boards(seasonId: string): Promise<Boards> {
    const [assisters, booked, keepers, incidents, lineups] = await Promise.all([
      this.store.assisters(seasonId),
      this.store.booked(seasonId),
      this.store.keepers(seasonId),
      this.store.declared(seasonId, 'incidents'),
      this.store.declared(seasonId, 'lineups'),
    ]);
    return {
      assists: covered(
        assisters.rows,
        assisters.assisted === 0,
        incidents,
        assisters.lastUpdatedAt,
      ),
      cards: covered(booked.rows, booked.rows.length === 0, incidents, booked.lastUpdatedAt),
      clean_sheets: cleanSheetsModule(keepers, lineups),
    };
  }
}

/**
 * The clean-sheets module's state (T-943): nothing judged is `not_supplied`
 * (or `delayed` when declared so); every side judged takes the declared
 * state as `covered` does; some sides unjudged is `limited` at best. The list
 * may be empty while judged sides exist -- nobody has kept one yet.
 */
export function cleanSheetsModule<T>(
  keepers: { rows: T[]; sides: number; judged: number; lastUpdatedAt: string | null },
  declared: CoverageState | null,
): Covered<T[]> {
  if (keepers.judged === 0) return covered<T[]>(null, true, declared, keepers.lastUpdatedAt);
  const whole = covered(keepers.rows, false, declared, keepers.lastUpdatedAt);
  const coverage =
    keepers.judged < keepers.sides && whole.coverage === 'available' ? 'limited' : whole.coverage;
  return { ...whole, coverage };
}
