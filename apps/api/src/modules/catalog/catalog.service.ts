import { Inject, Injectable } from '@nestjs/common';
import type {
  CompetitionContext,
  CompetitionDirectoryEntry,
  CompetitionPage,
  CompetitionTable,
  CompetitionSummary,
  CountrySummary,
  Covered,
  FollowSuggestionsResponse,
  LeagueZoneEntry,
  BoardPlayer,
  CoachPage,
  PlayerPage,
  PlayerProviderSeasons,
  TeamSeasonStats,
  PlayerTransfers,
  TeamTransfers,
  PlayerSeasonMinutes,
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
import { MediaService } from '../media/media.service';
import { LEADERS_LIMIT, StandingsService } from '../standings/standings.service';
import { buildBracket, tieOf } from './internal/bracket';
import { contextTable, phaseOf } from './internal/competition-context';
import { PostgresCompetitionStore } from './internal/competition-store';
import {
  candidatesForTop,
  leadersModule,
  leadersWithMinutes,
  rankByFigure,
  teamTopScorers,
  wholeOnlyIfRecorded,
} from './internal/leaders';
import { readCoachPage, readTeamHeadCoach } from './internal/coach-read';
import { readProviderSeasons } from './internal/player-provider-seasons';
import { readTeamSeasonStats } from './internal/team-season-stats';
import { readPlayerTransfers, readTeamTransfers } from './internal/transfers';
import { providerBoards, readProviderLeaders } from './internal/provider-leaders';
import {
  NO_LINEUPS,
  PostgresPlayerStore,
  availabilityOf,
  positionOf,
} from './internal/player-store';
import { buildSplits } from './internal/team-splits';
import { PostgresTeamStore } from './internal/team-store';

export type CompetitionOutcome =
  | { kind: 'ok'; page: CompetitionPage }
  | { kind: 'unknown_competition' }
  | { kind: 'unknown_season' }
  | { kind: 'no_seasons' };

export type CompetitionTableOutcome =
  | { kind: 'ok'; table: CompetitionTable }
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
    private readonly media: MediaService,
  ) {}

  /**
   * The coach page (T-1439, D-230): the coach, his career at the teams we
   * carry with their crests, and the line-ups that name him. `null` for a
   * person who is not a coach, or no such person.
   */
  async coach(id: string, locale: string | null = null): Promise<CoachPage | null> {
    const rows = await readCoachPage(this.pool, id, locale);
    if (rows === null) return null;
    const spells = rows.career.data ?? [];
    const media = await this.media.index({
      team: spells.map((s) => s.team.id),
      person: [id],
    });
    return {
      ...rows,
      coach: { ...rows.coach, photo: media.photo(id) },
      career: {
        ...rows.career,
        data:
          rows.career.data === null
            ? null
            : spells.map((s) => ({ ...s, team: { ...s.team, crest: media.crest(s.team.id) } })),
      },
    };
  }

  /**
   * A player's season totals and career as the provider counts them (T-1431,
   * D-223), apart from the record our line-ups support. `null` for no such player.
   */
  async playerProviderSeasons(id: string): Promise<PlayerProviderSeasons | null> {
    const { rowCount } = await this.pool.query(`SELECT 1 FROM person WHERE id = $1`, [id]);
    if (rowCount === 0) return null;
    return readProviderSeasons(this.pool, id);
  }

  /**
   * A team's season statistics as the provider counts them (T-1437, D-228).
   * `null` for no such team.
   */
  async teamSeasonStats(id: string, season: string | null): Promise<TeamSeasonStats | null> {
    const { rowCount } = await this.pool.query(`SELECT 1 FROM team WHERE id = $1`, [id]);
    if (rowCount === 0) return null;
    return readTeamSeasonStats(this.pool, id, season);
  }

  /** A player's transfers as the provider lists them (T-1440, D-231). `null` for no such player. */
  async playerTransfers(id: string, locale: string | null): Promise<PlayerTransfers | null> {
    const { rowCount } = await this.pool.query(`SELECT 1 FROM person WHERE id = $1`, [id]);
    if (rowCount === 0) return null;
    return readPlayerTransfers(this.pool, id, locale);
  }

  /** A club's arrivals and departures as the provider lists them (T-1440, D-231). `null` for no such club. */
  async teamTransfers(id: string, locale: string | null): Promise<TeamTransfers | null> {
    const { rowCount } = await this.pool.query(`SELECT 1 FROM team WHERE id = $1`, [id]);
    if (rowCount === 0) return null;
    return readTeamTransfers(this.pool, id, locale);
  }

  /** The player page (blueprint 5.3): identity, spells, the record our line-ups support, recent matches. */
  async player(id: string, locale: string | null = null): Promise<PlayerOutcome> {
    const found = await this.players_.person(id, locale);
    if (found === null) return { kind: 'unknown_player' };
    const [spells, record, recent, availability, media, positions] = await Promise.all([
      this.players_.spells(id),
      this.players_.record(id),
      this.players_.recent(id, RECENT_MATCHES),
      this.players_.availability(id),
      this.media.index({ person: [id] }),
      this.players_.positionSources(id),
    ]);
    const person = { ...found, photo: media.photo(id) };
    const currentSpell = spells.find((s) => s.end_date === null) ?? null;
    return {
      kind: 'ok',
      page: {
        person,
        current_spell: currentSpell,
        // A player with no open spell still has a position our squad
        // listings or line-ups name (T-1603).
        position: positionOf(currentSpell, positions),
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
   * The competitions directory (T-1433): every active competition with its
   * country, in the product's order for the reader's language -- the scores
   * page's rule (D-207): a language with an order of its own in
   * `competition_display_order` reads it and a competition it does not place
   * has none; a language with no rows there, or no locale, reads
   * `competition.display_order`. Unplaced ones follow, by country and name
   * (`directoryOrder`). Names are localised by the interceptor (T-1312).
   */
  async directory(locale: string | null): Promise<CompetitionDirectoryEntry[]> {
    const { rows } = await this.pool.query<DirectoryRow>(
      `SELECT c.id, c.name, c.short_name, c.scope, c.kind,
              co.id AS country_id, co.name AS country_name, co.code AS country_code,
              CASE WHEN EXISTS (SELECT 1 FROM competition_display_order lo WHERE lo.locale = $1)
                   THEN (SELECT lo.position FROM competition_display_order lo
                          WHERE lo.competition_id = c.id AND lo.locale = $1)
                   ELSE c.display_order END AS stated_order
         FROM competition c
         LEFT JOIN country co ON co.id = c.country_id
        WHERE c.is_active`,
      [orderSubtag(locale)],
    );
    const media = await this.media.index({ competition: rows.map((r) => r.id) });
    return directoryOrder(
      rows.map((r) => ({
        id: r.id,
        name: r.name,
        short_name: r.short_name,
        scope: r.scope,
        kind: r.kind,
        country:
          r.country_id === null
            ? null
            : { id: r.country_id, name: r.country_name ?? '', code: r.country_code ?? '' },
        order: r.stated_order,
        logo: media.logo(r.id),
      })),
    );
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
  /**
   * The league table alone (T-1460), for the homepage: the same competition,
   * season choice and rows as `competition`, with the logo and the crests,
   * and nothing else read. The page's other modules cost 200-400 ms more on
   * production and the homepage, which reads two tables, showed none of them.
   */
  async competitionTable(
    id: string,
    seasonId: string | null,
    locale: string | null = null,
  ): Promise<CompetitionTableOutcome> {
    const competition = await this.competitions_.competition(id, locale);
    if (competition === null) return { kind: 'unknown_competition' };
    const seasons = await this.competitions_.seasons(id);
    const selected = pickSeason(seasons, seasonId);
    if (selected === undefined)
      return { kind: seasons.length === 0 ? 'no_seasons' : 'unknown_season' };
    const table = await this.standings.table(selected.id);
    const media = await this.media.index({
      competition: [competition.id],
      team: (table.data ?? []).map((r) => r.team.id),
    });
    return {
      kind: 'ok',
      table: {
        competition: { ...competition, logo: media.logo(competition.id) },
        season: selected,
        table: {
          ...table,
          data:
            table.data === null
              ? null
              : table.data.map((r) => ({
                  ...r,
                  team: { ...r.team, crest: media.crest(r.team.id) },
                })),
        },
      },
    };
  }

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
    // Every scorer and every board row is read, then ranked here: a tie at the
    // cut-off is broken by appearances, which only the line-ups know (T-1441).
    const [
      stages,
      { fixtures, lastUpdatedAt },
      coverage,
      table,
      recordedScorers,
      recordedBoards,
      tally,
      bracketFixtures,
      division,
    ] = await Promise.all([
      this.competitions_.stages(selected.id),
      this.competitions_.fixtures(selected.id),
      this.competitions_.coverage(selected.id),
      this.standings.table(selected.id),
      this.standings.leaders(selected.id, null),
      this.standings.boards(selected.id),
      this.standings.incidentTally(selected.id),
      knockout ? this.competitions_.bracketFixtures(selected.id) : Promise.resolve(null),
      this.competitions_.division(id),
    ]);
    // Group tables (T-1336) only for a season with a group stage: a league
    // reads nothing more and answers exactly as before (`group_tables: null`).
    const groupTables = stages.some((s) => s.kind === 'group')
      ? await this.standings.groupStandings(selected.id)
      : null;

    // D-232: our own incidents are the source. Only a season of which we store
    // none falls back to the provider's season totals, if it has any.
    const providerLines =
      tally.incidents === 0
        ? await readProviderLeaders(this.pool, competition.id, selected.label)
        : [];
    const fromProvider = providerLines.length > 0;
    const provider = fromProvider ? providerBoards(providerLines) : null;
    const scorers = provider?.scorers ?? wholeOnlyIfRecorded(recordedScorers, tally);
    const assistsModule = provider?.assists ?? wholeOnlyIfRecorded(recordedBoards.assists, tally);
    const cardsModule = provider?.cards ?? wholeOnlyIfRecorded(recordedBoards.cards, tally);

    // The tables as ranked rows. Each is cut to the rows that can make the
    // table once ties are broken, unless a floor is asked for, which needs all.
    const onlyWith = <T>(module: Covered<T[]>, has: (row: T) => boolean): Covered<T[]> => ({
      ...module,
      data: module.data === null ? null : module.data.filter(has),
    });
    const tables = {
      scorers: { module: scorers, figure: (r: { goals: number }) => r.goals },
      assists: { module: assistsModule, figure: (r: { assists: number }) => r.assists },
      clean_sheets: {
        module: recordedBoards.clean_sheets,
        figure: (r: { clean_sheets: number }) => r.clean_sheets,
      },
      yellow_cards: {
        module: onlyWith(cardsModule, (r) => r.yellow_cards > 0),
        figure: (r: { yellow_cards: number }) => r.yellow_cards,
      },
      red_cards: {
        module: onlyWith(cardsModule, (r) => r.red_cards > 0),
        figure: (r: { red_cards: number }) => r.red_cards,
      },
    };
    const candidates = <T extends { person: { id: string } }>(
      module: Covered<T[]>,
      figure: (row: T) => number,
    ): T[] =>
      module.data === null
        ? []
        : minMinutes === null
          ? candidatesForTop(module.data, figure, LEADERS_LIMIT)
          : module.data;
    const picked = {
      scorers: candidates(tables.scorers.module, tables.scorers.figure),
      assists: candidates(tables.assists.module, tables.assists.figure),
      clean_sheets: candidates(tables.clean_sheets.module, tables.clean_sheets.figure),
      yellow_cards: candidates(tables.yellow_cards.module, tables.yellow_cards.figure),
      red_cards: candidates(tables.red_cards.module, tables.red_cards.figure),
    };
    const ids = (rows: { person: { id: string } }[]) => rows.map((r) => r.person.id);
    // Minutes and appearances from our line-ups for the recorded tables (the
    // boards count the main competition only, D-209), from the provider's
    // own lines for the provider's.
    const recordedMinutes = await this.players_.minutesByPerson(
      [selected.id],
      [
        ...new Set([
          ...(fromProvider ? [] : [...ids(picked.scorers), ...ids(picked.assists)]),
          ...ids(picked.clean_sheets),
          ...(fromProvider ? [] : [...ids(picked.yellow_cards), ...ids(picked.red_cards)]),
        ]),
      ],
      null,
      true,
    );
    const minutes = provider === null ? recordedMinutes : provider.minutes;
    const board = <T extends { person: { id: string; name: string } }>(
      module: Covered<T[]>,
      rows: T[],
      figure: (row: T) => number,
      minutesOf: ReadonlyMap<string, PlayerSeasonMinutes>,
    ) => {
      const result = leadersWithMinutes(
        rankByFigure(rows, figure, minutesOf),
        minutesOf,
        minMinutes,
        LEADERS_LIMIT,
      );
      return { module: leadersModule(module, result), unproven: result.unproven };
    };
    const scored = board(tables.scorers.module, picked.scorers, tables.scorers.figure, minutes);
    const assists = board(tables.assists.module, picked.assists, tables.assists.figure, minutes);
    const cleanSheets = board(
      tables.clean_sheets.module,
      picked.clean_sheets,
      tables.clean_sheets.figure,
      recordedMinutes,
    );
    const yellows = board(
      tables.yellow_cards.module,
      picked.yellow_cards,
      tables.yellow_cards.figure,
      minutes,
    );
    const reds = board(tables.red_cards.module, picked.red_cards, tables.red_cards.figure, minutes);
    const results = fixtures.filter((f) => f.status === 'finished').reverse();
    const upcoming = fixtures.filter((f) => f.status !== 'finished');
    // The logo, the table's crests and the leaders' photos from our own origin
    // (T-1320), and the other boards' rows too (T-1321), in one query.
    const leaders = scored.module;
    const boardRows = [
      ...(leaders.data ?? []),
      ...(assists.module.data ?? []),
      ...(cleanSheets.module.data ?? []),
      ...(yellows.module.data ?? []),
      ...(reds.module.data ?? []),
    ];
    const media = await this.media.index({
      competition: [competition.id],
      team: [
        ...(table.data ?? []).map((r) => r.team.id),
        ...(groupTables?.data ?? []).flatMap((g) => g.teams.map((t) => t.id)),
        ...boardRows.flatMap((l) => (l.team === null ? [] : [l.team.id])),
      ],
      person: boardRows.map((l) => l.person.id),
    });
    const withLeaderMedia = <
      L extends {
        person: { id: string; name: string };
        team: { id: string; name: string } | null;
      },
    >(
      l: L,
    ): L => ({
      ...l,
      person: { ...l.person, photo: media.photo(l.person.id) },
      team: l.team === null ? null : { ...l.team, crest: media.crest(l.team.id) },
    });
    const boardWithMedia = <L extends BoardPlayer>(module: Covered<L[]>): Covered<L[]> => ({
      ...module,
      data: module.data === null ? null : module.data.map(withLeaderMedia),
    });
    return {
      kind: 'ok',
      page: {
        competition: { ...competition, logo: media.logo(competition.id) },
        seasons,
        season: { ...selected, stages },
        table: {
          ...table,
          data:
            table.data === null
              ? null
              : table.data.map((r) => ({
                  ...r,
                  team: { ...r.team, crest: media.crest(r.team.id) },
                })),
        },
        group_tables:
          groupTables === null
            ? null
            : {
                ...groupTables,
                data:
                  groupTables.data === null
                    ? null
                    : groupTables.data.map((g) => ({
                        ...g,
                        rows: g.rows.map((r) => ({
                          ...r,
                          team: { ...r.team, crest: media.crest(r.team.id) },
                        })),
                        teams: g.teams.map((t) => ({ ...t, crest: media.crest(t.id) })),
                      })),
              },
        // T-1167 (D-171): the committed list, never the feed's standings.
        zones: leagueZonesFor(
          leagueZoneList as LeagueZoneEntry[],
          {
            kind: competition.kind,
            division,
            // D-234: a league the model does not hold is keyed by its country.
            country:
              competition.scope === 'domestic' &&
              competition.gender === 'men' &&
              competition.age_group === 'senior'
                ? (competition.country?.code ?? null)
                : null,
            tier: competition.tier,
          },
          selected.label,
        ),
        results,
        fixtures: upcoming,
        leaders: {
          ...leaders,
          data: leaders.data === null ? null : leaders.data.map(withLeaderMedia),
        },
        leaders_filter: {
          min_minutes: minMinutes,
          unproven: scored.unproven,
          presets: [...LEADERS_MINUTES_PRESETS],
        },
        boards: {
          assists: boardWithMedia(assists.module),
          clean_sheets: boardWithMedia(cleanSheets.module),
          yellow_cards: boardWithMedia(yellows.module),
          red_cards: boardWithMedia(reds.module),
          unproven: {
            assists: assists.unproven,
            clean_sheets: cleanSheets.unproven,
            yellow_cards: yellows.unproven,
            red_cards: reds.unproven,
          },
        },
        leaders_source: fromProvider ? 'provider_totals' : 'recorded',
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
    const found = await this.teams_.team(id, locale);
    if (found === null) return { kind: 'unknown_team' };
    const seasons = await this.teams_.seasons(id);
    const seasonIds = seasons.map((s) => s.season.id);
    const [
      { fixtures, lastUpdatedAt },
      squad,
      followers,
      tables,
      splitFixtures,
      lineup,
      ground,
      seasonScorers,
    ] = await Promise.all([
      this.teams_.fixtures(id, seasonIds),
      this.teams_.squad(id),
      this.teams_.followers(id),
      Promise.all(seasons.map((s) => this.standings.table(s.season.id))),
      this.teams_.splitFixtures(id, seasonIds),
      this.teams_.latestLineup(id),
      // No ground recorded: where this season's home matches were played (D-209).
      found.venue === null
        ? this.teams_.fixtureGround(
            id,
            seasons.filter((s) => s.season.is_current).map((s) => s.season.id),
          )
        : Promise.resolve(null),
      // The top scorer per competition (T-1528, D-275), counted as the
      // competition page counts its scorers: whole only if recorded.
      Promise.all(
        seasons.map(async (s) => {
          const [scorers, tally] = await Promise.all([
            this.standings.leaders(s.season.id, null),
            this.standings.incidentTally(s.season.id),
          ]);
          return teamTopScorers(wholeOnlyIfRecorded(scorers, tally), id);
        }),
      ),
    ]);
    // Minutes for this team over the seasons the page covers (T-824).
    const squadMinutes = await this.players_.minutesByPerson(
      seasonIds,
      squad.players.map((p) => p.person.id),
      id,
    );
    // The head coach by the provider's coaches endpoint (T-1439, D-230), told
    // apart from the coach the latest line-up names.
    const headCoach = await readTeamHeadCoach(this.pool, id, locale, lineup?.coach?.id ?? null);
    // The crest (T-1320) and the squad's and coach's photos (T-1321) from our own origin, in one query.
    const media = await this.media.index({
      team: [id],
      person: [
        ...squad.players.map((p) => p.person.id),
        ...(headCoach.data === null ? [] : [headCoach.data.person.id]),
        ...seasonScorers.flatMap((module) => (module.data ?? []).map((r) => r.person.id)),
      ],
    });
    const team = { ...found, crest: media.crest(id) };
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
        // Limited while we hold fewer of the club's listed players than it listed (T-1428).
        squad: derived(
          squad.players.map((p) => ({
            ...p,
            person: { ...p.person, photo: media.photo(p.person.id) },
            minutes: squadMinutes.get(p.person.id) ?? NO_LINEUPS,
          })),
          Math.max(1, squad.listed ?? 0),
          squad.lastUpdatedAt,
        ),
        splits: buildSplits(seasons, splitFixtures),
        top_scorers: seasons.map((s, i) => {
          const module = seasonScorers[i]!;
          return {
            competition: s.competition,
            season: s.season,
            scorers: {
              ...module,
              data:
                module.data === null
                  ? null
                  : module.data.map((r) => ({
                      person: { ...r.person, photo: media.photo(r.person.id) },
                      goals: r.goals,
                    })),
            },
          };
        }),
        manager: managerOf(lineup),
        head_coach:
          headCoach.data === null
            ? { ...headCoach, data: null }
            : {
                ...headCoach,
                data: {
                  ...headCoach.data,
                  person: {
                    ...headCoach.data.person,
                    photo: media.photo(headCoach.data.person.id),
                  },
                },
              },
        fixture_ground: ground,
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

interface DirectoryRow {
  id: string;
  name: string;
  short_name: string | null;
  scope: CompetitionDirectoryEntry['scope'];
  kind: CompetitionDirectoryEntry['kind'];
  country_id: string | null;
  country_name: string | null;
  country_code: string | null;
  stated_order: number | null;
}

/**
 * The language subtag a stated order is kept under (D-207): `en-GB` reads
 * the `en` order; `null` (no locale, or none that parses) reads the default.
 */
export function orderSubtag(locale: string | null): string | null {
  if (locale === null) return null;
  const language = locale.split('-')[0]?.toLowerCase() ?? '';
  return /^[a-z]{2,3}$/.test(language) ? language : null;
}

/**
 * The directory in the product's order (T-1433), the scores page's rule
 * (T-504, D-207): a stated place first, lowest first; then the unplaced
 * ones by country name (none first, as the scores page sorts an empty
 * country) and competition name. Pure, so the order is one function.
 */
export function directoryOrder(
  entries: readonly CompetitionDirectoryEntry[],
): CompetitionDirectoryEntry[] {
  const stated = (a: number | null, b: number | null): number =>
    a === b ? 0 : a === null ? 1 : b === null ? -1 : a - b;
  return [...entries].sort(
    (a, b) =>
      stated(a.order, b.order) ||
      (a.country?.name ?? '').localeCompare(b.country?.name ?? '') ||
      a.name.localeCompare(b.name) ||
      (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
}
