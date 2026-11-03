import {
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpException,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiError,
  OwnPredictionShareResponse,
  PredictionShareResponse,
  PublicPredictionShareResponse,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PredictionShareService } from './prediction-share.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
// Somebody else's prediction answers exactly as one that does not exist.
const NO_PREDICTION: ApiError = { error: 'not_found', message: 'No such prediction of yours.' };
const NO_CARD: ApiError = { error: 'not_found', message: 'No such card.' };

/**
 * A public link to one correct prediction's card (T-1723, D-351). The owner's
 * three routes are under `/me`; the public read takes the token and nothing
 * else.
 */
@Controller()
export class PredictionShareController {
  constructor(
    private readonly shares: PredictionShareService,
    private readonly identity: IdentityService,
  ) {}

  private async member(request: FastifyRequest): Promise<string> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return user.id;
  }

  @Get('me/predictions/:predictionId/share')
  async own(
    @Param('predictionId') predictionId: string,
    @Req() request: FastifyRequest,
  ): Promise<OwnPredictionShareResponse> {
    const userId = await this.member(request);
    if (!UUID.test(predictionId)) throw new NotFoundException(NO_PREDICTION);
    const answer = await this.shares.own(userId, predictionId.toLowerCase());
    if (answer === null) throw new NotFoundException(NO_PREDICTION);
    return answer;
  }

  /** Makes the link, or answers the one standing; only for a correct, settled pick. */
  @Post('me/predictions/:predictionId/share')
  @HttpCode(200)
  async create(
    @Param('predictionId') predictionId: string,
    @Req() request: FastifyRequest,
  ): Promise<PredictionShareResponse> {
    const userId = await this.member(request);
    if (!UUID.test(predictionId)) throw new NotFoundException(NO_PREDICTION);
    const outcome = await this.shares.create(userId, predictionId.toLowerCase());
    if (outcome.ok) return { share: outcome.share };
    switch (outcome.reason) {
      case 'not_found':
        throw new NotFoundException(NO_PREDICTION);
      case 'not_called':
        throw new ConflictException({
          error: 'conflict',
          message: 'Only a correct, settled pick has a card to share.',
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

  /** Revokes the live link: from now on it opens nothing. */
  @Delete('me/predictions/:predictionId/share')
  @HttpCode(204)
  async revoke(
    @Param('predictionId') predictionId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const userId = await this.member(request);
    if (!UUID.test(predictionId)) throw new NotFoundException(NO_PREDICTION);
    if (!(await this.shares.revoke(userId, predictionId.toLowerCase()))) {
      throw new NotFoundException(NO_PREDICTION);
    }
  }

  /** Public: what a live link shows. Unknown, revoked or no longer called: 404, the same answer. */
  @Get('prediction-shares/:token')
  async card(@Param('token') token: string): Promise<PublicPredictionShareResponse> {
    const card = await this.shares.card(token);
    if (card === null) throw new NotFoundException(NO_CARD);
    return { card };
  }
}
