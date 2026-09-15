import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiError,
  GroupPredictionCall,
  GroupPredictionComparisonResponse,
  PredictionHistoryResponse,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { ForbiddenException } from '@nestjs/common';
import { GroupsService } from '../groups/groups.service';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { ProfileService } from '../profile/profile.service';
import { parseHistoryQuery, type HistoryQuery } from './internal/history-query';
import { PredictionsService } from './predictions.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NO_USER: ApiError = { error: 'not_found', message: 'No such member.' };
const NO_GROUP: ApiError = { error: 'not_found', message: 'No such group.' };
const NO_FIXTURE: ApiError = { error: 'not_found', message: 'No such fixture.' };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/**
 * A member's prediction history over HTTP (blueprint 7.2, T-056). Visibility
 * is the member's `prediction_history_visibility`, decided by the profile
 * boundary before anything is serialised; a viewer who may not see it gets
 * the restricted shape, not the list.
 */
@Controller()
export class HistoryController {
  constructor(
    private readonly predictions: PredictionsService,
    private readonly profiles: ProfileService,
    private readonly identity: IdentityService,
    private readonly groups: GroupsService,
  ) {}

  /**
   * Who in a group called a fixture which way (blueprint 8.2, T-246).
   *
   * **Never a second settlement.** Every call carries the settlement that was
   * stored for it (T-052) and this route computes nothing: a comparison that
   * scored the calls itself would be a second answer, and on the day the two
   * disagreed there would be no saying which was the product's (rule 8).
   *
   * **And never a second visibility rule.** Whether a member's predictions may
   * be shown is `prediction_history_visibility`, decided by the profile
   * boundary -- the same control the member already has over their own history
   * (T-056), asked here in exactly the same way. A group is not a reason to
   * show what somebody has said not to show.
   */
  @Get('groups/:slug/fixtures/:fixtureId/predictions')
  async comparison(
    @Param('slug') slug: string,
    @Param('fixtureId') fixtureId: string,
    @Req() request: FastifyRequest,
  ): Promise<GroupPredictionComparisonResponse> {
    const viewer = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (viewer === null) throw new UnauthorizedException(UNAUTHENTICATED);

    const audience = await this.groups.audience(viewer.id, slug);
    if (!audience.ok) {
      if (audience.reason === 'not_found') throw new NotFoundException(NO_GROUP);
      throw new ForbiddenException({
        error: 'validation',
        message: 'Who is in this group is shown to its members.',
      } satisfies ApiError);
    }

    const found = await this.predictions.callsOn(fixtureId, audience.members);
    if (found === null) throw new NotFoundException(NO_FIXTURE);

    // Asked once per member who actually called this fixture, which is what
    // bounds it: a group of fifty with eight predictions asks eight times, not
    // fifty, and never for a member the answer would not be about.
    const shown: GroupPredictionCall[] = [];
    for (const call of found.calls) {
      const access = await this.profiles.predictionHistoryAccess(call.username, viewer.id);
      if (access.kind === 'visible') shown.push(call);
    }

    return {
      comparison: {
        fixture_id: fixtureId,
        kickoff_at: found.kickoffAt.toISOString(),
        locked: found.locked,
        calls: shown,
        silent: audience.members.length - found.calls.length,
        withheld: found.calls.length - shown.length,
      },
    };
  }

  @Get('users/:username/predictions')
  async theirs(
    @Param('username') username: string,
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ): Promise<PredictionHistoryResponse> {
    const paging = this.paging(query);
    const viewer = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    const access = await this.profiles.predictionHistoryAccess(username, viewer?.id ?? null);
    if (access.kind === 'unknown') throw new NotFoundException(NO_USER);
    if (access.kind === 'restricted')
      return { kind: 'restricted', username: access.username, visibility: access.visibility };
    const page = await this.predictions.history(access.userId, paging);
    return {
      kind: 'visible',
      username: access.username,
      is_self: access.isSelf,
      total: page.total,
      limit: paging.limit,
      offset: paging.offset,
      items: page.items,
    };
  }

  @Get('me/predictions')
  async mine(
    @Query() query: unknown,
    @Req() request: FastifyRequest,
  ): Promise<PredictionHistoryResponse> {
    const paging = this.paging(query);
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    const page = await this.predictions.history(user.id, paging);
    return {
      kind: 'visible',
      username: user.username,
      is_self: true,
      total: page.total,
      limit: paging.limit,
      offset: paging.offset,
      items: page.items,
    };
  }

  private paging(query: unknown): HistoryQuery {
    const parsed = parseHistoryQuery(isRecord(query) ? query : {});
    if (parsed.ok) return parsed.query;
    const error: ApiError = {
      error: 'validation',
      message: 'The request is not valid.',
      fields: parsed.fields,
    };
    throw new BadRequestException(error);
  }
}
