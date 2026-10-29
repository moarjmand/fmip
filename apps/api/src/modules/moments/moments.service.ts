import { Inject, Injectable } from '@nestjs/common';
import type { MomentForecast, MomentsResponse, ScoresFilters } from '@fmip/contracts';
import { FixturesService } from '../fixtures/fixtures.service';
import { ForecastService } from '../forecast/forecast.service';
import { HomepageFeatureService } from '../homepage/homepage.service';
import { ProfileService } from '../profile/profile.service';
import {
  cardsOf,
  forecastCandidates,
  momentForecast,
  pickMoments,
  readRange,
} from './internal/moments';

// The module's public surface. Other modules import from this file only.
export { parseMomentsQuery, type ParsedMomentsQuery } from './internal/moments';

/** What "now" is for the moments; a spec sets it to its own far-off day. */
export const MOMENTS_CLOCK = Symbol('MOMENTS_CLOCK');
export type MomentsClock = () => Date;

/**
 * Today's moments that matter (T-1641, D-299), read-only. The cards are the
 * scores page's own (a guest's answer, so the same for everybody, crests and
 * logos attached); the forecasts are the scores card's pre-kick-off batch;
 * the features are the homepage's. The viewer only decides `followed`.
 * Reads: the scores (cards, media), the features, the viewer's follows when
 * signed in, then one batch of forecasts -- never one per match.
 */
@Injectable()
export class MomentsService {
  constructor(
    private readonly fixtures: FixturesService,
    private readonly forecasts: ForecastService,
    private readonly features: HomepageFeatureService,
    private readonly profiles: ProfileService,
    @Inject(MOMENTS_CLOCK) private readonly clock: MomentsClock,
  ) {}

  async today(
    timeZone: string,
    locale: string | null,
    viewerId: string | null,
    bigOneLive = false,
  ): Promise<MomentsResponse> {
    const now = this.clock();
    const { from, to } = readRange(timeZone, now);
    const filters: ScoresFilters = {
      from,
      to,
      timezone: timeZone,
      live: false,
      favourites: false,
      country_id: null,
      competition_id: null,
      stage_id: null,
      gender: null,
      age: null,
    };
    const [{ response, statedOrder }, featured, follows] = await Promise.all([
      this.fixtures.rankedScores(filters, locale),
      this.features.featuredFixtureIds(),
      viewerId === null ? null : this.profiles.favouriteIds(viewerId),
    ]);
    const summaries = await this.forecasts.preKickoffFor(
      forecastCandidates(cardsOf(response), timeZone, now),
    );
    const forecasts = new Map<string, MomentForecast>();
    for (const entry of summaries) {
      const forecast = momentForecast(entry.pre_kickoff);
      if (forecast !== null) forecasts.set(entry.fixture_id, forecast);
    }

    const picked = pickMoments({
      now,
      timeZone,
      scores: response,
      statedOrder,
      featured: new Set(featured),
      forecasts,
      followedTeams: new Set(follows?.followed_team_ids ?? []),
      bigOneLive,
    });
    return { generated_at: now.toISOString(), timezone: timeZone, ...picked };
  }
}
