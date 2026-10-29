import { Module } from '@nestjs/common';
import { FixturesModule } from '../fixtures/fixtures.module';
import { ForecastModule } from '../forecast/forecast.module';
import { HomepageModule } from '../homepage/homepage.module';
import { IdentityModule } from '../identity/identity.module';
import { ProfileModule } from '../profile/profile.module';
import { MomentsController } from './moments.controller';
import { MOMENTS_CLOCK, MomentsService, type MomentsClock } from './moments.service';

/**
 * Today's moments that matter (T-1641, D-299): read-only, no table of its
 * own. Every read goes through another boundary's public service -- the
 * scores (fixtures), the pre-kick-off forecasts (forecast), the features
 * (homepage), the viewer's follows (profile) and the session (identity).
 */
@Module({
  imports: [IdentityModule, FixturesModule, ForecastModule, HomepageModule, ProfileModule],
  controllers: [MomentsController],
  providers: [
    MomentsService,
    { provide: MOMENTS_CLOCK, useValue: (() => new Date()) satisfies MomentsClock },
  ],
  exports: [MomentsService],
})
export class MomentsModule {}
