import { Injectable } from '@nestjs/common';
import type { MatchCentre, ScoresFilters, ScoresResponse } from '@fmip/contracts';
import { ProfileService } from '../profile/profile.service';
import { arrange, onlyFollowed } from './internal/arrange';
import { covered, derived } from './internal/covered';
import { FORM_WINDOW, PostgresMatchCentreStore } from './internal/match-centre-store';
import { PostgresScoresStore } from './internal/scores-store';

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
  ) {}

  async scores(filters: ScoresFilters, viewerId: string | null): Promise<ScoresOutcome> {
    if (filters.favourites && viewerId === null) return { kind: 'needs_session' };

    const prefs = viewerId === null ? null : await this.profiles.favouriteIds(viewerId);
    let rows = await this.store.list(filters);
    if (filters.favourites && prefs !== null) rows = onlyFollowed(rows, prefs);

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
    const { header, homeParticipantId, awayParticipantId } = head;

    const [coverage, incidents, statistics, lineups, homeForm, awayForm, meetings] =
      await Promise.all([
        this.centre.coverage(header.season.id),
        this.centre.incidents(fixtureId, homeParticipantId),
        this.centre.statistics(homeParticipantId, awayParticipantId),
        this.centre.lineups(homeParticipantId, awayParticipantId),
        this.centre.form(header.home.id, header.kickoff_at, fixtureId),
        this.centre.form(header.away.id, header.kickoff_at, fixtureId),
        this.centre.headToHead(header.home.id, header.away.id, header.kickoff_at, fixtureId),
      ]);

    const bothSides = lineups.home.length > 0 && lineups.away.length > 0;
    return {
      fixture: header,
      timeline: covered(
        incidents.rows,
        incidents.rows.length === 0,
        coverage.incidents,
        incidents.lastUpdatedAt,
      ),
      statistics: covered(
        statistics.rows,
        statistics.rows.length === 0,
        coverage.statistics,
        statistics.lastUpdatedAt,
      ),
      lineups: covered(
        { home: lineups.home, away: lineups.away },
        !bothSides,
        coverage.lineups,
        lineups.lastUpdatedAt,
      ),
      form: {
        home: derived(homeForm, FORM_WINDOW, homeForm[0]?.kickoff_at ?? null),
        away: derived(awayForm, FORM_WINDOW, awayForm[0]?.kickoff_at ?? null),
      },
      head_to_head: derived(meetings, FORM_WINDOW, meetings[0]?.kickoff_at ?? null),
      coverage,
    };
  }
}
