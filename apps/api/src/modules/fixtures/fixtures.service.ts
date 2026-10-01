import { Injectable } from '@nestjs/common';
import type {
  CoverageState,
  KeyPlayers,
  MatchCentre,
  ScoresFilters,
  ScoresResponse,
} from '@fmip/contracts';
import { MediaService } from '../media/media.service';
import { ProfileService } from '../profile/profile.service';
import { arrange, onlyFollowed } from './internal/arrange';
import { covered, derived } from './internal/covered';
import { availabilityOf, keyPlayersSide, pickKeyPlayers } from './internal/key-players';
import { PostgresKeyPlayersStore, type TeamSeason } from './internal/key-players-store';
import { FORM_WINDOW, PostgresMatchCentreStore } from './internal/match-centre-store';
import { PostgresScoresStore, type ScoredRow } from './internal/scores-store';

// The module's public surface. Other modules import from this file only.
export {
  MAX_RANGE_DAYS,
  dateIn,
  isTimeZone,
  parseScoresQuery,
  type ParsedScoresQuery,
} from './internal/scores-query';
export { covered, derived } from './internal/covered';
export { FORM_WINDOW } from './internal/match-centre-store';

export type ScoresOutcome = { kind: 'ok'; response: ScoresResponse } | { kind: 'needs_session' };

/**
 * The fixtures boundary's read side: the scores list (T-030) and the match
 * centre (T-033).
 *
 * The viewer's favourites come from the profile boundary's public service;
 * this module never reads `followed_entity` itself.
 */
@Injectable()
export class FixturesService {
  constructor(
    private readonly store: PostgresScoresStore,
    private readonly centre: PostgresMatchCentreStore,
    private readonly profiles: ProfileService,
    private readonly keyPlayers_: PostgresKeyPlayersStore,
    private readonly media: MediaService,
  ) {}

  /** Each card's crests and competition logo from our own origin (T-1320), in one query. */
  private async withMedia(rows: ScoredRow[]): Promise<ScoredRow[]> {
    if (rows.length === 0) return rows;
    const index = await this.media.index({
      team: rows.flatMap(({ card }) => [card.home.id, card.away.id]),
      competition: rows.map(({ card }) => card.competition.id),
    });
    return rows.map((row) => ({
      ...row,
      card: {
        ...row.card,
        competition: { ...row.card.competition, logo: index.logo(row.card.competition.id) },
        home: { ...row.card.home, crest: index.crest(row.card.home.id) },
        away: { ...row.card.away, crest: index.crest(row.card.away.id) },
      },
    }));
  }

  async scores(filters: ScoresFilters, viewerId: string | null): Promise<ScoresOutcome> {
    if (filters.favourites && viewerId === null) return { kind: 'needs_session' };

    const prefs = viewerId === null ? null : await this.profiles.favouriteIds(viewerId);
    let rows = await this.store.list(filters);
    if (filters.favourites && prefs !== null) rows = onlyFollowed(rows, prefs);
    rows = await this.withMedia(rows);

    const { pinned, groups } = arrange(rows, prefs);
    return {
      kind: 'ok',
      response: {
        filters,
        generated_at: new Date().toISOString(),
        total: rows.length,
        pinned,
        groups,
      },
    };
  }

  /**
   * Everything the match centre needs from our own tables, each module
   * labelled with a coverage state (blueprint 4.3). Null for an unknown id.
   */
  async matchCentre(fixtureId: string): Promise<MatchCentre | null> {
    const head = await this.centre.header(fixtureId);
    if (head === null) return null;
    const { header, homeParticipantId, awayParticipantId, detailOwed } = head;

    const [
      coverage,
      incidents,
      statistics,
      lineups,
      players,
      absences,
      homeForm,
      awayForm,
      meetings,
    ] = await Promise.all([
      this.centre.coverage(header.season.id),
      this.centre.incidents(fixtureId, homeParticipantId),
      this.centre.statistics(homeParticipantId, awayParticipantId),
      this.centre.lineups(homeParticipantId, awayParticipantId),
      this.centre.playerStatistics(homeParticipantId, awayParticipantId),
      this.centre.availability(fixtureId),
      this.centre.form(header.home.id, header.kickoff_at, fixtureId),
      this.centre.form(header.away.id, header.kickoff_at, fixtureId),
      this.centre.headToHead(header.home.id, header.away.id, header.kickoff_at, fixtureId),
    ]);

    // Crests, the logo and the line-up photos from our own origin (T-1320).
    const media = await this.media.index({
      team: [header.home.id, header.away.id],
      competition: [header.competition.id],
      person: [...lineups.home, ...lineups.away].map((p) => p.id),
    });
    const withPhoto = <P extends { id: string }>(p: P) => ({ ...p, photo: media.photo(p.id) });
    const fixture = {
      ...header,
      competition: { ...header.competition, logo: media.logo(header.competition.id) },
      home: { ...header.home, crest: media.crest(header.home.id) },
      away: { ...header.away, crest: media.crest(header.away.id) },
    };
    const bothSides = lineups.home.length > 0 && lineups.away.length > 0;
    // A finished match whose detail has not been asked for yet is owed it: a
    // module with nothing in it there is `delayed`, not the provider declining
    // (T-102). A module that has rows says what the season says, as ever.
    const owed = (empty: boolean, declared: CoverageState): CoverageState =>
      detailOwed && empty ? 'delayed' : declared;
    return {
      fixture,
      timeline: covered(
        incidents.rows,
        incidents.rows.length === 0,
        owed(incidents.rows.length === 0, coverage.incidents),
        incidents.lastUpdatedAt,
      ),
      statistics: covered(
        statistics.rows,
        statistics.rows.length === 0,
        owed(statistics.rows.length === 0, coverage.statistics),
        statistics.lastUpdatedAt,
      ),
      lineups: covered(
        { home: lineups.home.map(withPhoto), away: lineups.away.map(withPhoto) },
        !bothSides,
        owed(!bothSides, coverage.lineups),
        lineups.lastUpdatedAt,
      ),
      // Asked is answered, even when the answer is nobody (T-103): the list
      // is then `available` and empty, dated by the ask. Never asked is
      // `not_supplied`; the ingestion job asks about the next three days.
      availability:
        absences.askedAt === null
          ? { coverage: 'not_supplied', last_updated_at: null, data: null }
          : { coverage: 'available', last_updated_at: absences.askedAt, data: absences.rows },
      // Player numbers arrive with the team's statistics and have no season
      // profile of their own, so the team statistics' declared state stands in.
      player_statistics: covered(
        players.rows,
        players.rows.length === 0,
        owed(players.rows.length === 0, coverage.statistics),
        players.lastUpdatedAt,
      ),
      form: {
        home: derived(homeForm, FORM_WINDOW, homeForm[0]?.kickoff_at ?? null),
        away: derived(awayForm, FORM_WINDOW, awayForm[0]?.kickoff_at ?? null),
      },
      head_to_head: derived(meetings, FORM_WINDOW, meetings[0]?.kickoff_at ?? null),
      coverage,
    };
  }

  /**
   * The match centre's key players (T-841, blueprint 4.2): per side, the
   * players with the most minutes in this competition's season before the
   * match (`pickKeyPlayers`), with their season figures and what the provider
   * said about this match (T-103). Null for an unknown fixture.
   */
  async keyPlayers(fixtureId: string): Promise<KeyPlayers | null> {
    const fixture = await this.keyPlayers_.fixture(fixtureId);
    if (fixture === null) return null;
    const [home, away, absences] = await Promise.all([
      this.keyPlayers_.teamSeason(fixture.season.id, fixture.home.id, fixture.kickoffAt),
      this.keyPlayers_.teamSeason(fixture.season.id, fixture.away.id, fixture.kickoffAt),
      this.centre.availability(fixtureId),
    ]);
    const side = (team: { id: string; name: string }, season: TeamSeason) =>
      keyPlayersSide(
        team,
        season,
        pickKeyPlayers(season.players).map((p) => ({
          ...p,
          availability: availabilityOf(p.id, absences.rows, absences.askedAt),
        })),
        season.lastUpdatedAt,
      );
    return {
      fixture_id: fixture.id,
      competition: fixture.competition,
      season: fixture.season,
      home: side(fixture.home, home),
      away: side(fixture.away, away),
      availability_asked_at: absences.askedAt,
    };
  }
}
