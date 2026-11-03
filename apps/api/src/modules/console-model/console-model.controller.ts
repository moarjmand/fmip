import { Controller, Get, Req, UnauthorizedException } from '@nestjs/common';
import type { ApiError, ConsoleModelReport } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { ConsoleSessions } from '../agents-console/console-sessions.service';
import { EvaluationService } from '../forecast/evaluation.service';
import { ForecastService } from '../forecast/forecast.service';

// How long one read serves every viewer: the figures change once a match is scored.
export const CONSOLE_MODEL_CACHE_MS = 5 * 60_000;

const SIGNED_OUT: ApiError = { error: 'unauthenticated', message: 'Sign in to the console.' };

/**
 * The agents console's forecast-model page (T-1729, D-355): read-only, a
 * console session required, the same refusal as the console's own routes.
 * Every figure is the forecast module's, from the stored evaluations; the
 * model service is asked only which versions it runs now, and its silence
 * is said (`service: 'unreachable'`), never read as "none".
 */
@Controller('console')
export class ConsoleModelController {
  private cached: { at: number; report: ConsoleModelReport } | null = null;

  constructor(
    private readonly sessions: ConsoleSessions,
    private readonly evaluations: EvaluationService,
    private readonly forecasts: ForecastService,
  ) {}

  @Get('model')
  async model(@Req() request: FastifyRequest): Promise<ConsoleModelReport> {
    if ((await this.sessions.person(request)) === null) {
      throw new UnauthorizedException(SIGNED_OUT);
    }
    const now = new Date();
    if (this.cached !== null && now.getTime() - this.cached.at < CONSOLE_MODEL_CACHE_MS) {
      return this.cached.report;
    }
    const health = await this.forecasts.modelHealth();
    const report = await this.evaluations.consoleModel(
      health.ok ? { published: health.modelVersion, candidates: health.candidateVersions } : null,
      now,
    );
    this.cached = { at: now.getTime(), report };
    return report;
  }
}
