import { Controller, Get, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import type { ApiError, AuthUser, BriefingOutcome, BriefingResponse } from '@fmip/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { RateLimitsService, refuseOverRate } from '../rate-limits/rate-limits.service';
import { BriefingsService } from './briefings.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };

/**
 * A member's briefing (E43): `GET /me/briefing` is the document and the
 * prose or the reason there is none; `POST /me/briefing` asks for a new
 * version over the feed as it is now. Theirs alone: a briefing is written
 * from what they follow.
 */
@Controller('me')
export class BriefingsController {
  constructor(
    private readonly briefings: BriefingsService,
    private readonly identity: IdentityService,
    private readonly limits: RateLimitsService,
  ) {}

  @Get('briefing')
  async current(@Req() request: FastifyRequest): Promise<BriefingResponse> {
    const user = await this.member(request);
    return this.briefings.current(user.id);
  }

  /**
   * Every call asks the language model, whose allowance the whole product
   * shares, so it is held to the `briefing` ceiling before anything is read
   * (T-811, D-103).
   */
  @Post('briefing')
  async write(
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ): Promise<BriefingOutcome> {
    const user = await this.member(request);
    const taken = await this.limits.take(user.id, 'briefing');
    if (!taken.ok)
      refuseOverRate(reply, taken, 'You have asked for a lot of briefings in the last hour.');
    return this.briefings.write(user.id);
  }

  private async member(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return user;
  }
}
