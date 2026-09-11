import { Inject, Injectable } from '@nestjs/common';
import type {
  CompetitionPage,
  CompetitionSummary,
  CountrySummary,
  Covered,
  PlayerPage,
  SeasonSummary,
  TableContext,
  TableRow,
  TeamPage,
  TeamSummary,
} from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { derived } from '../fixtures/fixtures.service';
import { StandingsService } from '../standings/standings.service';
import { PostgresCompetitionStore } from './internal/competition-store';
import { PostgresPlayerStore } from './internal/player-store';
import { PostgresTeamStore } from './internal/team-store';

export type CompetitionOutcome =
  | { kind: 'ok'; page: CompetitionPage }
  | { kind: 'unknown_competition' }
  | { kind: 'unknown_season' }
  | { kind: 'no_seasons' };

export type TeamOutcome = { kind: 'ok'; page: TeamPage } | { kind: 'unknown_team' };
export type PlayerOutcome = { kind: 'ok'; page: PlayerPage } | { kind: 'unknown_player' };

/** How many matches the player page's recent log holds. */
export const RECENT_MATCHES = 10;

/** How many rows either side of the team the table context shows. */
export const CONTEXT_RADIUS = 2;

/**
 * The catalog boundary's read side: the lists a form or a follow control
 * needs, the competition page (T-035) and the team page (T-036). Tables come
 * from the standings boundary through its public service.
 */
@Injectable()
export class CatalogService {
  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly competitions_: PostgresCompetitionStore,
    private readonly teams_: PostgresTeamStore,
    private readonly players_: PostgresPlayerStore,
    private readonly standings: StandingsService,
  ) {}

  /** The player page (blueprint 5.3): identity, spells, the record our line-ups support, recent matches. */
  async player(id: string): Promise<PlayerOutcome> {
    const person = await this.players_.person(id);
    if (person === null) return { kind: 'unknown_player' };
    const [spells, record, recent] = await Promise.all([
      this.players_.spells(id),
      this.players_.record(id),
      this.players_.recent(id, RECENT_MATCHES),
    ]);
    return {
      kind: 'ok',
      page: {
        person,
        current_spell: spells.find((s) => s.end_date === null) ?? null,
        spells,
        record: derived(record, 1, recent.lastUpdatedAt),
        recent_matches: derived(recent.matches, 1, recent.lastUpdatedAt),
        last_updated_at: recent.lastUpdatedAt,
      },
    };
  }

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

  /** The team page (blueprint 5.2): the team, where it stands, its matches, its squad. */
  async team(id: string): Promise<TeamOutcome> {
    const team = await this.teams_.team(id);
    if (team === null) return { kind: 'unknown_team' };
    const seasons = await this.teams_.seasons(id);
    const [{ fixtures, lastUpdatedAt }, squad, followers, tables] = await Promise.all([
      this.teams_.fixtures(
        id,
        seasons.map((s) => s.season.id),
      ),
      this.teams_.squad(id),
      this.teams_.followers(id),
      Promise.all(seasons.map((s) => this.standings.table(s.season.id))),
    ]);
    const results = fixtures.filter((f) => f.status === 'finished').reverse();
    const upcoming = fixtures.filter((f) => f.status !== 'finished');
    return {
      kind: 'ok',
      page: {
        team,
        competitions: seasons.map((s, i) => ({
          competition: s.competition,
          season: s.season,
          context: tableContext(tables[i]!, id),
        })),
        next_match: upcoming[0] ?? null,
        previous_match: results[0] ?? null,
        fixtures: upcoming,
        results,
        squad: derived(squad.players, 1, squad.lastUpdatedAt),
        followers,
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

/**
 * The team's slice of a table: its row and up to `CONTEXT_RADIUS` neighbours
 * either side, under the table's own coverage. A table without the team
 * (a cup, or nothing played) carries no data.
 */
export function tableContext(table: Covered<TableRow[]>, teamId: string): Covered<TableContext> {
  const rows = table.data ?? [];
  const index = rows.findIndex((r) => r.team.id === teamId);
  if (index < 0) {
    return {
      coverage: table.coverage === 'delayed' ? 'delayed' : 'not_supplied',
      last_updated_at: table.last_updated_at,
      data: null,
    };
  }
  const row = rows[index]!;
  return {
    coverage: table.coverage,
    last_updated_at: table.last_updated_at,
    data: {
      position: row.position,
      total: rows.length,
      points: row.points,
      rows: rows.slice(Math.max(0, index - CONTEXT_RADIUS), index + CONTEXT_RADIUS + 1),
    },
  };
}
