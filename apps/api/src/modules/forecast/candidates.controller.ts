import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  AccuracyPeriod,
  AdminModelAccuracyResponse,
  ApiError,
  CandidateRecordsResponse,
} from '@fmip/contracts';
import { ACCURACY_PERIODS, ROLE_REFUSALS } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { EvaluationService } from './evaluation.service';
import { ForecastService, MODEL_CLIENT } from './forecast.service';
import { candidateRecords } from './internal/candidate-records';
import { PostgresEvaluationStore } from './internal/evaluation-store';
import type { ModelClient } from './internal/model-client';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };

/**
 * The candidates' shadow records for the console (T-1103, D-140): read-only,
 * administrators only (a member gets `forbidden`, D-108). Every number is
 * from the stored evaluations (T-066); the model service is asked only which
 * candidates it runs now, and its silence is said, never read as "none".
 * Each record carries whether the candidate answers at all (T-1165).
 */
@Controller('admin/model')
export class CandidatesController {
  constructor(
    private readonly evaluations: PostgresEvaluationStore,
    private readonly identity: IdentityService,
    private readonly forecasts: ForecastService,
    @Inject(MODEL_CLIENT) private readonly model: ModelClient,
    private readonly accuracyService: EvaluationService,
  ) {}

  @Get('candidates')
  async candidates(@Req() request: FastifyRequest): Promise<CandidateRecordsResponse> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin'))) {
      throw new ForbiddenException(ROLE_REFUSALS.administrator);
    }
    const now = new Date();
    const [counts, pairs, offered, shadow] = await Promise.all([
      this.evaluations.candidateCounts(),
      this.evaluations.candidatePairs(),
      this.offered(),
      this.forecasts.candidateShadow(now),
    ]);
    return candidateRecords(counts, pairs, offered, now, shadow);
  }

  /**
   * Accuracy over time (T-1369, D-187): every model version in each role,
   * published and shadow, overall and per competition, by ISO week or month.
   * Read-only, administrators only, the same refusals as the candidates.
   */
  @Get('accuracy')
  async accuracy(
    @Req() request: FastifyRequest,
    @Query('period') period: unknown,
  ): Promise<AdminModelAccuracyResponse> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin'))) {
      throw new ForbiddenException(ROLE_REFUSALS.administrator);
    }
    const chosen = period === undefined ? 'week' : period;
    if (typeof chosen !== 'string' || !ACCURACY_PERIODS.includes(chosen as AccuracyPeriod)) {
      const error: ApiError = {
        error: 'validation',
        message: 'The request is not valid.',
        fields: { period: 'must be week or month' },
      };
      throw new BadRequestException(error);
    }
    return this.accuracyService.adminAccuracy(chosen as AccuracyPeriod, new Date());
  }

  /** The versions the service runs now; null when it did not answer. */
  private async offered(): Promise<string[] | null> {
    try {
      const listed = await this.model.candidates();
      if (listed.ok) return listed.data.map((c) => c.model_version);
      // A service from before T-1102 has no list and no named candidate.
      return listed.kind === 'http' && listed.status === 404 ? [] : null;
    } catch {
      return null;
    }
  }
}
