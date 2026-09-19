import { Controller, Get, Post, Req, UnauthorizedException } from '@nestjs/common';
import type { ApiError, AuthUser, BriefingOutcome, BriefingResponse } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
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
  ) {}

  @Get('briefing')
  async current(@Req() request: FastifyRequest): Promise<BriefingResponse> {
    const user = await this.member(request);
    return this.briefings.current(user.id);
  }

  @Post('briefing')
  async write(@Req() request: FastifyRequest): Promise<BriefingOutcome> {
    const user = await this.member(request);
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
