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
import type { ApiError, PredictionHistoryResponse } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { ProfileService } from '../profile/profile.service';
import { parseHistoryQuery, type HistoryQuery } from './internal/history-query';
import { PredictionsService } from './predictions.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NO_USER: ApiError = { error: 'not_found', message: 'No such member.' };

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
  ) {}

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
