import { Injectable } from '@nestjs/common';
import type { ScoresFilters, ScoresResponse } from '@fmip/contracts';
import { ProfileService } from '../profile/profile.service';
import { arrange, onlyFollowed } from './internal/arrange';
import { PostgresScoresStore } from './internal/scores-store';

// The module's public surface. Other modules import from this file only.
export {
  MAX_RANGE_DAYS,
  dateIn,
  isTimeZone,
  parseScoresQuery,
  type ParsedScoresQuery,
} from './internal/scores-query';

export type ScoresOutcome = { kind: 'ok'; response: ScoresResponse } | { kind: 'needs_session' };

/**
 * The fixtures boundary's read side (T-030): the scores list. Match centre
 * reads arrive with T-033 in the same service.
 *
 * The viewer's favourites come from the profile boundary's public service;
 * this module never reads `followed_entity` itself.
 */
@Injectable()
export class FixturesService {
  constructor(
    private readonly store: PostgresScoresStore,
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
}
