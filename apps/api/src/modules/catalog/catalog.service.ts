import { Inject, Injectable } from '@nestjs/common';
import type {
  CompetitionPage,
  CompetitionSummary,
  CountrySummary,
  SeasonSummary,
  TeamSummary,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { StandingsService } from '../standings/standings.service';
import { PostgresCompetitionStore } from './internal/competition-store';

export type CompetitionOutcome =
  | { kind: 'ok'; page: CompetitionPage }
  | { kind: 'unknown_competition' }
  | { kind: 'unknown_season' }
  | { kind: 'no_seasons' };

/**
 * The catalog boundary's read side: the lists a form or a follow control
 * needs, and the competition page (T-035). The table and the leaders come
 * from the standings boundary through its public service.
 */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly competitions_: PostgresCompetitionStore,
    private readonly standings: StandingsService,
  ) {}

  async countries(): Promise<CountrySummary[]> {
    const { rows } = await this.pool.query<CountrySummary>(
      `SELECT id, code, iso2, name FROM country ORDER BY name`,
    );
    return rows;
  }

  async teams(): Promise<TeamSummary[]> {
    const { rows } = await this.pool.query<TeamSummary>(
      `SELECT id, name, short_name, code, kind, country_id
         FROM team WHERE is_active ORDER BY name`,
    );
    return rows;
  }

  async competitions(): Promise<CompetitionSummary[]> {
    const { rows } = await this.pool.query<CompetitionSummary>(
      `SELECT id, name, short_name, scope, country_id
         FROM competition WHERE is_active ORDER BY name`,
    );
    return rows;
  }

  /**
   * The competition page for one season: `seasonId` when given (and the
   * competition's own), else the current season, else the newest.
   */
  async competition(id: string, seasonId: string | null): Promise<CompetitionOutcome> {
    const competition = await this.competitions_.competition(id);
    if (competition === null) return { kind: 'unknown_competition' };
    const seasons = await this.competitions_.seasons(id);
    const selected = pickSeason(seasons, seasonId);
    if (selected === undefined)
      return { kind: seasons.length === 0 ? 'no_seasons' : 'unknown_season' };

    const [stages, { fixtures, lastUpdatedAt }, coverage, table, leaders] = await Promise.all([
      this.competitions_.stages(selected.id),
      this.competitions_.fixtures(selected.id),
      this.competitions_.coverage(selected.id),
      this.standings.table(selected.id),
      this.standings.leaders(selected.id),
    ]);
    const results = fixtures.filter((f) => f.status === 'finished').reverse();
    const upcoming = fixtures.filter((f) => f.status !== 'finished');
    return {
      kind: 'ok',
      page: {
        competition,
        seasons,
        season: { ...selected, stages },
        table,
        results,
        fixtures: upcoming,
        leaders,
        coverage,
        last_updated_at: lastUpdatedAt,
      },
    };
  }
}

/** Pure, so the selector rule is one function: requested, else current, else newest. */
export function pickSeason(
  seasons: readonly SeasonSummary[],
  requested: string | null,
): SeasonSummary | undefined {
  if (requested !== null) return seasons.find((s) => s.id === requested);
  return seasons.find((s) => s.is_current) ?? seasons[0];
}
