import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, AuthUser, PendingPickResponse } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PendingPickService } from './pending-pick.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_FIXTURE: ApiError = { error: 'not_found', message: 'No such fixture.' };
const NONE_WAITING: ApiError = {
  error: 'not_found',
  message: 'You have no pick waiting on this match.',
};
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to pick.' };

const locked = (locksAt?: string): ApiError => ({
  error: 'locked',
  message:
    locksAt === undefined
      ? 'Picks for this match locked at kick-off.'
      : `Picks for this match locked at kick-off (${locksAt}).`,
});

/**
 * `/fixtures/:fixtureId/pending-pick` (T-1740, D-361): the signed-in member's
 * own pick made before their e-mail address is confirmed. Guests get 401 on
 * every verb. Nobody reads another member's: the member is the session's and
 * no route here takes one.
 *
 * A member whose address is confirmed is refused on `PUT` with 409
 * `conflict` -- not a 403: they are allowed to pick, by the prediction route
 * (`PUT /fixtures/:fixtureId/prediction`), and this one has nothing to hold
 * for them.
 */
@Controller('fixtures/:fixtureId/pending-pick')
export class PendingPickController {
  constructor(
    private readonly picks: PendingPickService,
    private readonly identity: IdentityService,
  ) {}

  private async member(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return user;
  }

  /** The member's pick on the match as it stands, or `null`: 200 either way. */
  @Get()
  async own(
    @Param('fixtureId') fixtureId: string,
    @Req() request: FastifyRequest,
  ): Promise<PendingPickResponse> {
    const user = await this.member(request);
    if (!UUID.test(fixtureId)) throw new NotFoundException(NO_FIXTURE);
    return { pending_pick: await this.picks.own(user.id, fixtureId.toLowerCase()) };
  }

  /** Leaves the outcome waiting, in place of the one already waiting. */
  @Put()
  async save(
    @Param('fixtureId') fixtureId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<PendingPickResponse> {
    const user = await this.member(request);
    if (!UUID.test(fixtureId)) throw new NotFoundException(NO_FIXTURE);
    const outcome = await this.picks.save(
      { id: user.id, emailVerified: user.email_verified },
      fixtureId.toLowerCase(),
      body,
    );
    switch (outcome.kind) {
      case 'saved':
        return { pending_pick: outcome.pick };
      case 'unknown_fixture':
        throw new NotFoundException(NO_FIXTURE);
      case 'email_verified':
        throw new ConflictException({
          error: 'conflict',
          message: 'Your e-mail address is confirmed: predict the match itself.',
        } satisfies ApiError);
      case 'locked':
        throw new ConflictException(locked(outcome.locksAt));
      case 'invalid':
        throw new BadRequestException({
          error: 'validation',
          message: 'The pick is not valid.',
          fields: outcome.fields,
        } satisfies ApiError);
      case 'rate_limited':
        throw new HttpException(
          {
            error: 'rate_limited',
            message: 'That is more than this hour allows.',
          } satisfies ApiError,
          429,
        );
    }
  }

  /** Takes back the pick waiting on a match that has not kicked off. */
  @Delete()
  @HttpCode(204)
  async withdraw(
    @Param('fixtureId') fixtureId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.member(request);
    if (!UUID.test(fixtureId)) throw new NotFoundException(NO_FIXTURE);
    switch (await this.picks.withdraw(user.id, fixtureId.toLowerCase())) {
      case 'withdrawn':
        return;
      case 'unknown_fixture':
        throw new NotFoundException(NO_FIXTURE);
      case 'none_waiting':
        throw new NotFoundException(NONE_WAITING);
      case 'locked':
        // Saved, not counted: kept and said, not removed.
        throw new ConflictException(locked());
    }
  }
}
