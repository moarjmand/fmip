import { Inject, Injectable } from '@nestjs/common';
import type {
  CompetitionPage,
  CompetitionSummary,
  CountrySummary,
  Covered,
  FollowSuggestionsResponse,
  PlayerPage,
  SeasonSummary,
  SuggestedCompetition,
  SuggestedTeam,
  TableContext,
  TableRow,
  TeamPage,
  TeamSummary,
} from '@fmip/contracts';
import { SUGGESTED_TEAMS_PER_COMPETITION } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { derived } from '../fixtures/fixtures.service';
import { StandingsService } from '../standings/standings.service';
import { buildBracket } from './internal/bracket';
import { PostgresCompetitionStore } from './internal/competition-store';
import { PostgresPlayerStore } from './internal/player-store';
import { buildSplits } from './internal/team-splits';
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
  async player(id: string, locale: string | null = null): Promise<PlayerOutcome> {
    const person = await this.players_.person(id, locale);
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
      // The database's own collation is byte order on the Alpine image, which
      // files "Côte d'Ivoire" after "Czechia" and "Türkiye" after "Turks and
      // Caicos Islands"; ICU's root order is the one a reader expects.
      `SELECT id, code, iso2, name FROM country ORDER BY name COLLATE "und-x-icu"`,
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
   * What a member who follows nothing can follow next (T-622): every active
   * competition with the teams of its season (current, else newest -- the
   * same rule as `pickSeason`) that members follow most. Everything comes
   * from stored rows; a competition with no season or no fixture yet is
   * listed with no teams rather than given some from elsewhere.
   */
  async followSuggestions(): Promise<FollowSuggestionsResponse> {
    const { rows } = await this.pool.query<SuggestionRow>(
      `WITH picked AS (
         SELECT DISTINCT ON (competition_id) competition_id, id, label
           FROM season
          ORDER BY competition_id, is_current DESC, start_date DESC, label DESC
       ),
       played AS (
         SELECT DISTINCT pk.competition_id, fp.team_id
           FROM picked pk
           JOIN fixture f ON f.season_id = pk.id
           JOIN fixture_participant fp ON fp.fixture_id = f.id
       )
       SELECT c.id, c.name, c.short_name, c.scope, c.country_id, c.display_order,
              pk.id AS season_id, pk.label AS season_label,
              t.id AS team_id, t.name AS team_name, t.short_name AS team_short_name,
              t.code AS team_code, t.kind AS team_kind, t.country_id AS team_country_id,
              (SELECT count(*) FROM followed_entity fe
                WHERE fe.entity_type = 'team' AND fe.entity_id = t.id)::int AS followers
         FROM competition c
         LEFT JOIN picked pk ON pk.competition_id = c.id
         LEFT JOIN played pl ON pl.competition_id = c.id
         LEFT JOIN team t ON t.id = pl.team_id AND t.is_active
        WHERE c.is_active`,
    );
    return {
      competitions: groupSuggestions(rows, SUGGESTED_TEAMS_PER_COMPETITION),
      ranked_by: 'followers',
    };
  }

  /**
   * The competition page for one season: `seasonId` when given (and the
   * competition's own), else the current season, else the newest.
   */
  async competition(
    id: string,
    seasonId: string | null,
    locale: string | null = null,
  ): Promise<CompetitionOutcome> {
    const competition = await this.competitions_.competition(id, locale);
    if (competition === null) return { kind: 'unknown_competition' };
    const seasons = await this.competitions_.seasons(id);
    const selected = pickSeason(seasons, seasonId);
    if (selected === undefined)
      return { kind: seasons.length === 0 ? 'no_seasons' : 'unknown_season' };

    const knockout = playsKnockoutBracket(competition);
    const [stages, { fixtures, lastUpdatedAt }, coverage, table, leaders, bracketFixtures] =
      await Promise.all([
        this.competitions_.stages(selected.id),
        this.competitions_.fixtures(selected.id),
        this.competitions_.coverage(selected.id),
        this.standings.table(selected.id),
        this.standings.leaders(selected.id),
        knockout ? this.competitions_.bracketFixtures(selected.id) : Promise.resolve(null),
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
        bracket:
          bracketFixtures === null
            ? null
            : buildBracket(bracketFixtures, seasonIsOpen(selected, new Date())),
        coverage,
        last_updated_at: lastUpdatedAt,
      },
    };
  }

  /** The team page (blueprint 5.2): the team, where it stands, its matches, its squad. */
  async team(id: string, locale: string | null = null): Promise<TeamOutcome> {
    const team = await this.teams_.team(id, locale);
    if (team === null) return { kind: 'unknown_team' };
    const seasons = await this.teams_.seasons(id);
    const seasonIds = seasons.map((s) => s.season.id);
    const [{ fixtures, lastUpdatedAt }, squad, followers, tables, splitFixtures] =
      await Promise.all([
        this.teams_.fixtures(id, seasonIds),
        this.teams_.squad(id),
        this.teams_.followers(id),
        Promise.all(seasons.map((s) => this.standings.table(s.season.id))),
        this.teams_.splitFixtures(id, seasonIds),
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
        splits: buildSplits(seasons, splitFixtures),
        followers,
        last_updated_at: lastUpdatedAt,
      },
    };
  }
}

/**
 * Whether the competition page shows a knockout bracket (T-630): the
 * continental cups, whose rounds after the league stage are the UEFA ones.
 */
export function playsKnockoutBracket(competition: {
  kind: CompetitionPage['competition']['kind'];
  scope: CompetitionPage['competition']['scope'];
}): boolean {
  return competition.kind === 'cup' && competition.scope === 'continental';
}

/** One row of the suggestions query: a competition, its season, and one of its teams (or none). */
export interface SuggestionRow {
  id: string;
  name: string;
  short_name: string | null;
  scope: CompetitionSummary['scope'];
  country_id: string | null;
  display_order: number | null;
  season_id: string | null;
  season_label: string | null;
  team_id: string | null;
  team_name: string | null;
  team_short_name: string | null;
  team_code: string | null;
  team_kind: TeamSummary['kind'] | null;
  team_country_id: string | null;
  followers: number | null;
}

/**
 * Pure, so the suggestion rule is one function (T-622): competitions in their
 * scores-page order (a stated `display_order` first, then by name), each with
 * at most `limit` teams, most followed first and then by name.
 */
export function groupSuggestions(
  rows: readonly SuggestionRow[],
  limit: number,
): SuggestedCompetition[] {
  const byCompetition = new Map<string, { row: SuggestionRow; teams: SuggestedTeam[] }>();
  for (const row of rows) {
    let entry = byCompetition.get(row.id);
    if (entry === undefined) {
      entry = { row, teams: [] };
      byCompetition.set(row.id, entry);
    }
    if (row.team_id !== null && row.team_name !== null && row.team_kind !== null) {
      entry.teams.push({
        id: row.team_id,
        name: row.team_name,
        short_name: row.team_short_name,
        code: row.team_code,
        kind: row.team_kind,
        country_id: row.team_country_id,
        followers: row.followers ?? 0,
      });
    }
  }
  const byName = (a: string, b: string): number => a.localeCompare(b, 'en');
  return [...byCompetition.values()]
    .sort(
      (a, b) =>
        (a.row.display_order ?? Number.MAX_SAFE_INTEGER) -
          (b.row.display_order ?? Number.MAX_SAFE_INTEGER) || byName(a.row.name, b.row.name),
    )
    .map(({ row, teams }) => ({
      competition: {
        id: row.id,
        name: row.name,
        short_name: row.short_name,
        scope: row.scope,
        country_id: row.country_id,
      },
      season:
        row.season_id !== null && row.season_label !== null
          ? { id: row.season_id, label: row.season_label }
          : null,
      teams: teams
        .sort((a, b) => b.followers - a.followers || byName(a.name, b.name))
        .slice(0, limit),
    }));
}

/** A season still running: the current one, or one whose last day has not passed. */
export function seasonIsOpen(season: SeasonSummary, now: Date): boolean {
  return season.is_current || season.end_date >= now.toISOString().slice(0, 10);
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
