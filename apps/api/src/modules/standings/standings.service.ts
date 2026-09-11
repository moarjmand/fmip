import { Injectable } from '@nestjs/common';
import type { Covered, Leader, TableRow } from '@fmip/contracts';
import { covered } from '../fixtures/fixtures.service';
import { PostgresStandingsStore } from './internal/standings-store';
import { rankTable } from './internal/table';

// The module's public surface. Other modules import from this file only.
export { FORM_WINDOW, rankTable, type Result } from './internal/table';

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

  /** Top goalscorers of a season from recorded goal incidents. */
  async leaders(seasonId: string, limit = LEADERS_LIMIT): Promise<Covered<Leader[]>> {
    const [{ leaders, lastUpdatedAt }, declared] = await Promise.all([
      this.store.scorers(seasonId, limit),
      this.store.declared(seasonId, 'incidents'),
    ]);
    return covered(leaders, leaders.length === 0, declared, lastUpdatedAt);
  }
}
