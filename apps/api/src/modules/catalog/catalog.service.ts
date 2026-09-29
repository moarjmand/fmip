import { Inject, Injectable } from '@nestjs/common';
import type {
  CompetitionContext,
  CompetitionPage,
  CompetitionSummary,
  CountrySummary,
  Covered,
  FollowSuggestionsResponse,
  LeagueZoneEntry,
  PlayerPage,
  SeasonSummary,
  SuggestedCompetition,
  SuggestedTeam,
  TableContext,
  TableRow,
  TeamManager,
  TeamPage,
  TeamSummary,
} from '@fmip/contracts';
import {
  LEADERS_MINUTES_PRESETS,
  SUGGESTED_TEAMS_PER_COMPETITION,
  leagueZonesFor,
} from '@fmip/contracts';
import leagueZoneList from '@fmip/contracts/zones/league-zones.json';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { derived } from '../fixtures/fixtures.service';
import { LEADERS_LIMIT, StandingsService } from '../standings/standings.service';
import { buildBracket, tieOf } from './internal/bracket';
import { contextTable, phaseOf } from './internal/competition-context';
import { PostgresCompetitionStore } from './internal/competition-store';
import { leadersModule, leadersWithMinutes } from './internal/leaders';
import { NO_LINEUPS, PostgresPlayerStore, availabilityOf } from './internal/player-store';
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
    const [spells, record, recent, availability] = await Promise.all([
      this.players_.spells(id),
      this.players_.record(id),
      this.players_.recent(id, RECENT_MATCHES),
      this.players_.availability(id),
    ]);
    return {
      kind: 'ok',
      page: {
        person,
        current_spell: spells.find((s) => s.end_date === null) ?? null,
        spells,
        record: derived(record, 1, recent.lastUpdatedAt),
        recent_matches: derived(recent.matches, 1, recent.lastUpdatedAt),
        availability: availabilityOf(availability),
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
   * same rule as `pickSeason`) that play its main phase (`mainPhaseTeams`),
   * most followed first, then by their place in the season's table when one
   * exists, then by name. Everything comes from stored rows; a competition
   * with no season or no fixture yet is listed with no teams rather than
   * given some from elsewhere.
   */
  async followSuggestions(): Promise<FollowSuggestionsResponse> {
    const { rows } = await this.pool.query<SuggestionRow>(
      `WITH picked AS (
         SELECT DISTINCT ON (competition_id) competition_id, id, label
           FROM season
          ORDER BY competition_id, is_current DESC, start_date DESC, label DESC
       ),
       played AS (
         -- Every stage kind the team played in that season; a NULL element
         -- for a fixture with no stage (array_agg keeps it).
         SELECT pk.competition_id, fp.team_id, array_agg(DISTINCT st.kind) AS stage_kinds
           FROM picked pk
           JOIN fixture f ON f.season_id = pk.id
           LEFT JOIN stage st ON st.id = f.stage_id
           JOIN fixture_participant fp ON fp.fixture_id = f.id
          GROUP BY pk.competition_id, fp.team_id
       )
       SELECT c.id, c.name, c.short_name, c.scope, c.country_id, c.display_order,
              pk.id AS season_id, pk.label AS season_label,
              t.id AS team_id, t.name AS team_name, t.short_name AS team_short_name,
              t.code AS team_code, t.kind AS team_kind, t.country_id AS team_country_id,
              pl.stage_kinds,
              (SELECT count(*) FROM followed_entity fe
                WHERE fe.entity_type = 'team' AND fe.entity_id = t.id)::int AS followers
         FROM competition c
         LEFT JOIN picked pk ON pk.competition_id = c.id
         LEFT JOIN played pl ON pl.competition_id = c.id
         LEFT JOIN team t ON t.id = pl.team_id AND t.is_active
        WHERE c.is_active`,
    );
    // The tie-break after followers: each team's place in its season's table,
    // computed by the standings boundary as the competition page shows it.
    const seasonIds = [
      ...new Set(
        rows.flatMap((r) => (r.season_id !== null && r.team_id !== null ? [r.season_id] : [])),
      ),
    ];
    const tables = await Promise.all(seasonIds.map((id) => this.standings.table(id)));
    const positions = new Map<string, number>();
    seasonIds.forEach((seasonId, i) => {
      for (const row of tables[i]?.data ?? []) {
        positions.set(`${seasonId}:${row.team.id}`, row.position);
      }
    });
    return {
      competitions: groupSuggestions(rows, SUGGESTED_TEAMS_PER_COMPETITION, positions),
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
    minMinutes: number | null = null,
  ): Promise<CompetitionOutcome> {
    const competition = await this.competitions_.competition(id, locale);
    if (competition === null) return { kind: 'unknown_competition' };
    const seasons = await this.competitions_.seasons(id);
    const selected = pickSeason(seasons, seasonId);
    if (selected === undefined)
      return { kind: seasons.length === 0 ? 'no_seasons' : 'unknown_season' };

    const knockout = playsKnockoutBracket(competition);
    // Under a minutes floor every scorer is read, since the first ten by
    // goals may not be the first ten that reached it (T-824).
    const [
      stages,
      { fixtures, lastUpdatedAt },
      coverage,
      table,
      scorers,
      boards,
      bracketFixtures,
      division,
    ] = await Promise.all([
      this.competitions_.stages(selected.id),
      this.competitions_.fixtures(selected.id),
      this.competitions_.coverage(selected.id),
      this.standings.table(selected.id),
      this.standings.leaders(selected.id, minMinutes === null ? LEADERS_LIMIT : null),
      this.standings.boards(selected.id),
      knockout ? this.competitions_.bracketFixtures(selected.id) : Promise.resolve(null),
      this.competitions_.division(id),
    ]);
    // The boards beyond goals (T-943) are read whole, so their minutes are
    // read only for the rows each board can show without a floor.
    const shown = <T extends { person: { id: string } }>(rows: T[] | null) =>
      (rows ?? []).slice(0, minMinutes === null ? LEADERS_LIMIT : undefined);
    const minutes = await this.players_.minutesByPerson(
      [selected.id],
      [
        ...new Set(
          [
            ...(scorers.data ?? []),
            ...shown(boards.assists.data),
            ...shown(boards.clean_sheets.data),
            ...shown(boards.cards.data),
          ].map((s) => s.person.id),
        ),
      ],
      null,
    );
    const filtered = leadersWithMinutes(scorers.data ?? [], minutes, minMinutes, LEADERS_LIMIT);
    const board = <T extends { person: { id: string } }>(module: Covered<T[]>) => {
      const result = leadersWithMinutes(shown(module.data), minutes, minMinutes, LEADERS_LIMIT);
      return { module: leadersModule(module, result), unproven: result.unproven };
    };
    const assists = board(boards.assists);
    const cleanSheets = board(boards.clean_sheets);
    const cards = board(boards.cards);
    const results = fixtures.filter((f) => f.status === 'finished').reverse();
    const upcoming = fixtures.filter((f) => f.status !== 'finished');
    return {
      kind: 'ok',
      page: {
        competition,
        seasons,
        season: { ...selected, stages },
        table,
        // T-1167 (D-171): the committed list, never the feed's standings.
        zones: leagueZonesFor(
          leagueZoneList as LeagueZoneEntry[],
          { kind: competition.kind, division },
          selected.label,
        ),
        results,
        fixtures: upcoming,
        leaders: leadersModule(scorers, filtered),
        leaders_filter: {
          min_minutes: minMinutes,
          unproven: filtered.unproven,
          presets: [...LEADERS_MINUTES_PRESETS],
        },
        boards: {
          assists: assists.module,
          clean_sheets: cleanSheets.module,
          cards: cards.module,
          unproven: {
            assists: assists.unproven,
            clean_sheets: cleanSheets.unproven,
            cards: cards.unproven,
          },
        },
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
    const [{ fixtures, lastUpdatedAt }, squad, followers, tables, splitFixtures, lineup] =
      await Promise.all([
        this.teams_.fixtures(id, seasonIds),
        this.teams_.squad(id),
        this.teams_.followers(id),
        Promise.all(seasons.map((s) => this.standings.table(s.season.id))),
        this.teams_.splitFixtures(id, seasonIds),
        this.teams_.latestLineup(id),
      ]);
    // Minutes for this team over the seasons the page covers (T-824).
    const squadMinutes = await this.players_.minutesByPerson(
      seasonIds,
      squad.players.map((p) => p.person.id),
      id,
    );
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
        squad: derived(
          squad.players.map((p) => ({
            ...p,
            minutes: squadMinutes.get(p.person.id) ?? NO_LINEUPS,
          })),
          1,
          squad.lastUpdatedAt,
        ),
        splits: buildSplits(seasons, splitFixtures),
        manager: managerOf(lineup),
        followers,
        last_updated_at: lastUpdatedAt,
      },
    };
  }

  /**
   * The match centre's competition context (T-840, blueprint 4.2): the table
   * or group as it stood before kick-off, or the knockout tie. Null for an
   * unknown fixture.
   */
  async competitionContext(fixtureId: string): Promise<CompetitionContext | null> {
    const f = await this.competitions_.fixtureContext(fixtureId);
    if (f === null) return null;
    const phase = phaseOf({
      competitionKind: f.competition.kind,
      stage: f.stage,
      round: f.round,
      groupName: f.groupName,
    });

    let table: CompetitionContext['table'] = null;
    let knockout: CompetitionContext['knockout'] = null;
    if (phase.kind === 'league') {
      const before = await this.standings.tableBefore(f.season.id, f.kickoffAt);
      table = contextTable(before, 'league', null, f.homeId, f.awayId);
    } else if (phase.kind === 'group') {
      // A group we cannot name is a group we cannot rank: said, not guessed.
      table =
        phase.stageId === null || phase.groupName === null
          ? { coverage: 'not_supplied', last_updated_at: null, data: null }
          : contextTable(
              await this.standings.tableBefore(f.season.id, f.kickoffAt, {
                stageId: phase.stageId,
                name: phase.groupName,
              }),
              'group',
              phase.groupName,
              f.homeId,
              f.awayId,
            );
    } else if (phase.kind === 'knockout') {
      const found = tieOf(await this.competitions_.bracketFixtures(f.season.id), f.id, {
        continental: playsKnockoutBracket(f.competition),
        stageLegs: f.stage?.legs ?? null,
      });
      if (found !== null) {
        knockout = {
          round: f.round ?? f.stage?.name ?? null,
          round_key: found.roundKey,
          legs_expected: found.legs,
          tie: found.tie,
        };
      }
    }

    return {
      fixture_id: f.id,
      competition: { id: f.competition.id, name: f.competition.name, kind: f.competition.kind },
      season: f.season,
      stage: f.stage === null ? null : { name: f.stage.name, kind: f.stage.kind },
      round: f.round,
      group_name: f.groupName,
      table,
      knockout,
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
  /** Stage kinds the team played in that season; a `null` element for a fixture with no stage. */
  stage_kinds: (string | null)[] | null;
  followers: number | null;
}

/** Stage kinds of a competition's main phase; qualifying rounds and play-offs are not. */
const MAIN_PHASE_KINDS: ReadonlySet<string> = new Set(['league', 'group', 'knockout']);

/**
 * The teams of a season that play its main phase (T-622): when the season
 * holds a league, group or knockout stage, the teams with a fixture in one;
 * else (a league whose fixtures carry no stage) the teams with a fixture
 * outside any stage. Qualifying rounds and play-offs never count on their
 * own: a club knocked out in the qualifiers is not suggested, and a season
 * still in its qualifiers suggests no one yet. Knockout play-offs after a
 * league stage lose no one, since their teams played that stage.
 */
export function mainPhaseTeams<T extends { stage_kinds: readonly (string | null)[] }>(
  teams: readonly T[],
): T[] {
  const main = (t: T): boolean => t.stage_kinds.some((k) => k !== null && MAIN_PHASE_KINDS.has(k));
  if (teams.some(main)) return teams.filter(main);
  return teams.filter((t) => t.stage_kinds.includes(null));
}

interface Candidate {
  team: SuggestedTeam;
  stage_kinds: readonly (string | null)[];
  position: number;
}

/**
 * Pure, so the suggestion rule is one function (T-622): competitions in their
 * scores-page order (a stated `display_order` first, then by name), each with
 * at most `limit` of the teams that play its main phase (`mainPhaseTeams`),
 * most followed first, then by table position (`positions`, keyed
 * `season:team`; a team with none after those with one), then by name.
 */
export function groupSuggestions(
  rows: readonly SuggestionRow[],
  limit: number,
  positions: ReadonlyMap<string, number> = new Map(),
): SuggestedCompetition[] {
  const byCompetition = new Map<string, { row: SuggestionRow; teams: Candidate[] }>();
  for (const row of rows) {
    let entry = byCompetition.get(row.id);
    if (entry === undefined) {
      entry = { row, teams: [] };
      byCompetition.set(row.id, entry);
    }
    if (row.team_id !== null && row.team_name !== null && row.team_kind !== null) {
      entry.teams.push({
        team: {
          id: row.team_id,
          name: row.team_name,
          short_name: row.team_short_name,
          code: row.team_code,
          kind: row.team_kind,
          country_id: row.team_country_id,
          followers: row.followers ?? 0,
        },
        stage_kinds: row.stage_kinds ?? [null],
        position: positions.get(`${row.season_id}:${row.team_id}`) ?? Number.MAX_SAFE_INTEGER,
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
      teams: mainPhaseTeams(teams)
        .sort(
          (a, b) =>
            b.team.followers - a.team.followers ||
            a.position - b.position ||
            byName(a.team.name, b.team.name),
        )
        .slice(0, limit)
        .map((c) => c.team),
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

/**
 * The team page's manager (T-944, D-119): the coach named on the most recent
 * stored line-up, `available` as a fact about that match; `not_supplied` when
 * that line-up names none or the team has no line-up at all -- never an
 * older coach carried forward, and never a spell's guess.
 */
export function managerOf(
  lineup: {
    fixture: { id: string; kickoff_at: string };
    coach: { id: string; name: string } | null;
    updatedAt: string;
  } | null,
): TeamManager {
  if (lineup === null) {
    return {
      coach: { coverage: 'not_supplied', last_updated_at: null, data: null },
      lineup_fixture: null,
    };
  }
  return {
    coach:
      lineup.coach === null
        ? { coverage: 'not_supplied', last_updated_at: lineup.updatedAt, data: null }
        : { coverage: 'available', last_updated_at: lineup.updatedAt, data: lineup.coach },
    lineup_fixture: lineup.fixture,
  };
}
