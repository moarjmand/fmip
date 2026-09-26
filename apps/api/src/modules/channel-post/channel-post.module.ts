import { Controller, Get, Module } from '@nestjs/common';
import type { ChannelPostHealth } from '@fmip/contracts';
import { FixturesModule } from '../fixtures/fixtures.module';
import { ForecastModule } from '../forecast/forecast.module';
import {
  CHANNEL_POST_CONFIG,
  type ChannelPostConfig,
  channelPostConfigFromEnv,
} from './channel-post.port';
import { ChannelPostService } from './channel-post.service';
import { PostgresChannelPostStore } from './internal/channel-post-store';

/**
 * `GET /health/channel` (T-525): whether a channel is configured, whether
 * this instance posts to it, and how the newest day went. `absent` is the
 * normal state of a deployment and is reported as a fact.
 */
@Controller()
export class ChannelPostHealthController {
  constructor(private readonly posts: ChannelPostService) {}

  @Get('health/channel')
  health(): Promise<ChannelPostHealth> {
    return this.posts.health();
  }
}

/**
 * The daily channel post (T-525, E52). Reads the scores list and the model's
 * forecasts through their public services and nothing else -- no founder's
 * analysis, no consensus (rule 6). The channel is read from the environment
 * once; half a configuration stops the process at boot.
 */
@Module({
  imports: [FixturesModule, ForecastModule],
  controllers: [ChannelPostHealthController],
  providers: [
    ChannelPostService,
    PostgresChannelPostStore,
    {
      provide: CHANNEL_POST_CONFIG,
      useFactory: (): ChannelPostConfig => channelPostConfigFromEnv(),
    },
  ],
  exports: [ChannelPostService],
})
export class ChannelPostModule {}
