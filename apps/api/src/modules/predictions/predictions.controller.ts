import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  Put,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, PredictionResponse } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PredictionsService } from './predictions.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_FIXTURE: ApiError = { error: 'not_found', message: 'No such fixture.' };
const NO_PREDICTION: ApiError = {
  error: 'not_found',
  message: 'You have not predicted this match.',
};
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to predict.' };

/**
 * `/fixtures/:id/prediction`: the signed-in member's own prediction.
 * Guests get 401 on both verbs; an unverified e-mail gets 403 on PUT.
 */
@Controller('fixtures/:fixtureId/prediction')
export class PredictionsController {
  constructor(
    private readonly predictions: PredictionsService,
    private readonly identity: IdentityService,
  ) {}

  @Get()
  async own(
    @Param('fixtureId') fixtureId: string,
    @Req() request: FastifyRequest,
  ): Promise<PredictionResponse> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!UUID.test(fixtureId)) throw new NotFoundException(NO_FIXTURE);
    const prediction = await this.predictions.own(user.id, fixtureId.toLowerCase());
    if (prediction === null) throw new NotFoundException(NO_PREDICTION);
    return { prediction };
  }

  @Put()
  async submit(
    @Param('fixtureId') fixtureId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<PredictionResponse> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!UUID.test(fixtureId)) throw new NotFoundException(NO_FIXTURE);

    const outcome = await this.predictions.submit(
      { id: user.id, emailVerified: user.email_verified },
      fixtureId.toLowerCase(),
      body,
    );
    switch (outcome.kind) {
      case 'submitted':
        return { prediction: outcome.prediction };
      case 'unknown_fixture':
        throw new NotFoundException(NO_FIXTURE);
      case 'email_unverified': {
        const error: ApiError = {
          error: 'email_unverified',
          message: 'Verify your e-mail address before predicting.',
        };
        throw new ForbiddenException(error);
      }
      case 'locked': {
        const error: ApiError = {
          error: 'locked',
          message: `Predictions for this match locked at kick-off (${outcome.locksAt}).`,
        };
        throw new ConflictException(error);
      }
      case 'invalid': {
        const error: ApiError = {
          error: 'validation',
          message: 'The prediction is not valid.',
          fields: outcome.fields,
        };
        throw new BadRequestException(error);
      }
    }
  }
}
