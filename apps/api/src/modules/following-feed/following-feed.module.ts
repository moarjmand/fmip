import { Controller, Get, Module, Req, UnauthorizedException } from '@nestjs/common';
import type { ApiError, FollowingFeed } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityModule } from '../identity/identity.module';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { ProfileModule } from '../profile/profile.module';
import { FollowingFeedService } from './following-feed.service';
import { PostgresFollowingFeedStore } from './internal/following-feed-store';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };

/** `GET /me/feed` (T-333). A member's own; a guest has nothing to follow. */
@Controller()
export class FollowingFeedController {
  constructor(
    private readonly feed: FollowingFeedService,
    private readonly identity: IdentityService,
  ) {}

  @Get('me/feed')
  async mine(@Req() request: FastifyRequest): Promise<FollowingFeed> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return this.feed.feed(user.id);
  }
}

/**
 * The Following feed boundary (blueprint 12.1, T-333). It imports identity
 * (who is asking) and profile (what they follow, through its public service)
 * and reads the rest -- matches, stories, analyses, posts -- as tables, so it
 * depends on no football boundary's module and none depends on it.
 */
@Module({
  imports: [IdentityModule, ProfileModule],
  controllers: [FollowingFeedController],
  providers: [FollowingFeedService, PostgresFollowingFeedStore],
  exports: [FollowingFeedService],
})
export class FollowingFeedModule {}
