import {
  BadRequestException,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiError,
  FixtureEvaluationsResponse,
  ModelPerformanceResponse,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { EvaluationService } from './evaluation.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_FIXTURE: ApiError = { error: 'not_found', message: 'No such fixture.' };
const NO_COMPETITION: ApiError = { error: 'not_found', message: 'No such competition.' };
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };

/**
 * Evaluations are read by anyone; running one is an operator action over HTTP
 * (the result-ingestion job of E2 will call the service directly).
 */
@Controller()
export class EvaluationController {
  constructor(
    private readonly evaluations: EvaluationService,
    private readonly identity: IdentityService,
  ) {}

  @Get('fixtures/:fixtureId/evaluations')
  async list(@Param('fixtureId') fixtureId: string): Promise<FixtureEvaluationsResponse> {
    if (!UUID.test(fixtureId)) throw new NotFoundException(NO_FIXTURE);
    const response = await this.evaluations.evaluations(fixtureId.toLowerCase());
    if (response === null) throw new NotFoundException(NO_FIXTURE);
    return response;
  }

  @Post('fixtures/:fixtureId/evaluations')
  @HttpCode(201)
  async evaluate(
    @Param('fixtureId') fixtureId: string,
    @Req() request: FastifyRequest,
  ): Promise<FixtureEvaluationsResponse> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin'))) {
      const error: ApiError = {
        error: 'unauthenticated',
        message: 'Evaluating a fixture needs the admin role.',
      };
      throw new ForbiddenException(error);
    }
    if (!UUID.test(fixtureId)) throw new NotFoundException(NO_FIXTURE);

    const outcome = await this.evaluations.evaluateFixture(fixtureId.toLowerCase());
    switch (outcome.kind) {
      case 'unknown_fixture':
        throw new NotFoundException(NO_FIXTURE);
      case 'not_finished': {
        const error: ApiError = {
          error: 'conflict',
          message: `The fixture is ${outcome.status}, not finished.`,
        };
        throw new ConflictException(error);
      }
      case 'no_final_score': {
        const error: ApiError = {
          error: 'conflict',
          message: 'The fixture has no full-time score yet.',
        };
        throw new ConflictException(error);
      }
      case 'evaluated': {
        const last = outcome.evaluations.at(-1);
        return {
          fixture_id: fixtureId.toLowerCase(),
          coverage: outcome.evaluations.length === 0 ? 'not_supplied' : 'available',
          last_updated_at: last?.evaluated_at ?? null,
          evaluations: outcome.evaluations,
        };
      }
    }
  }

  @Get('competitions/:competitionId/model-performance')
  async performance(
    @Param('competitionId') competitionId: string,
    @Query('season') season: unknown,
  ): Promise<ModelPerformanceResponse> {
    if (!UUID.test(competitionId)) throw new NotFoundException(NO_COMPETITION);
    let seasonId: string | null = null;
    if (season !== undefined) {
      if (typeof season !== 'string' || !UUID.test(season)) {
        const error: ApiError = {
          error: 'validation',
          message: 'The request is not valid.',
          fields: { season: 'must be a season id' },
        };
        throw new BadRequestException(error);
      }
      seasonId = season.toLowerCase();
    }
    const response = await this.evaluations.performance(competitionId.toLowerCase(), seasonId);
    if (response === null) throw new NotFoundException(NO_COMPETITION);
    return response;
  }
}
