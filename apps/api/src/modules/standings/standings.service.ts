import { Injectable } from '@nestjs/common';
import type { CoverageState, Covered, GroupTable, TableRow } from '@fmip/contracts';
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

/** One group of a group stage as it stands (T-1333; T-1336 adds what the page needs). */
export interface SeasonGroupTable {
  stageId: string;
  stageName: string;
  name: string;
  /** Ranked over the group's finished matches; every team at nought when none is. */
  rows: TableRow[];
  /** Every team of the group, by name. */
  teams: TableRow['team'][];
  /** Finished matches the rows are counted from. */
  counted: number;
  lastUpdatedAt: string | null;
}

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
  async groupTables(seasonId: string): Promise<SeasonGroupTable[]> {
    const groups = await this.store.seasonGroups(seasonId);
    return Promise.all(
      groups.map(async (group) => {
        const [{ results, lastUpdatedAt }, participants] = await Promise.all([
          this.store.groupResults(group.stageId, group.name, null),
          this.store.groupParticipants(group.stageId, group.name),
        ]);
        return {
          ...group,
          rows: rankTable(results, participants),
          teams: participants,
          counted: results.length,
          lastUpdatedAt,
        };
      }),
    );
  }

  /**
   * The competition page's group tables (T-1336): every group of the
   * season's group stages, ranked exactly as `groupTables` ranks them (the
   * match centre's group line counts the same matches), under the season's
   * declared standings coverage. A group none of whose matches is finished
   * has no positions yet: its rows are empty and its teams are listed, never
   * a grid of noughts ordered by name. No group known at all is the honest
   * absence of the module, not an empty list.
   */
  async groupStandings(seasonId: string): Promise<Covered<GroupTable[]>> {
    const [groups, declared] = await Promise.all([
      this.groupTables(seasonId),
      this.store.declared(seasonId, 'standings'),
    ]);
    return groupStandingsModule(groups, declared);
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

/**
 * The group tables as the competition page carries them (T-1336), pure so
 * a unit spec holds it: each group under its stage, rows only once a match
 * of the group is finished, the newest change across the groups, and the
 * declared state as `covered` gives it -- no group at all is `not_supplied`
 * (or `delayed` when declared so).
 */
export function groupStandingsModule(
  groups: SeasonGroupTable[],
  declared: CoverageState | null,
): Covered<GroupTable[]> {
  let last: string | null = null;
  for (const g of groups)
    if (g.lastUpdatedAt !== null && (last === null || g.lastUpdatedAt > last))
      last = g.lastUpdatedAt;
  const data = groups.map((g): GroupTable => ({
    stage: { id: g.stageId, name: g.stageName },
    group: g.name,
    counted: g.counted,
    rows: g.counted === 0 ? [] : g.rows,
    teams: g.teams,
  }));
  return covered(data, data.length === 0, declared, last);
}
