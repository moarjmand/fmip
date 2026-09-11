import {
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, FixtureSettlementsResponse, SettlementRunResponse } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { SettlementService } from './settlement.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_FIXTURE: ApiError = { error: 'not_found', message: 'No such fixture.' };

/**
 * Settlement over HTTP (T-052): the aggregate per fixture is public (how the
 * crowd did); running settlement is an operator action until the job runner
 * (T-026) calls the service directly.
 */
@Controller()
export class SettlementController {
  constructor(
    private readonly settlement: SettlementService,
    private readonly identity: IdentityService,
  ) {}

  @Get('fixtures/:fixtureId/settlements')
  async forFixture(@Param('fixtureId') fixtureId: string): Promise<FixtureSettlementsResponse> {
    if (!UUID.test(fixtureId)) throw new NotFoundException(NO_FIXTURE);
    const response = await this.settlement.forFixture(fixtureId.toLowerCase());
    if (response === null) throw new NotFoundException(NO_FIXTURE);
    return response;
  }

  @Post('fixtures/:fixtureId/settle')
  @HttpCode(200)
  async settle(
    @Param('fixtureId') fixtureId: string,
    @Req() request: FastifyRequest,
  ): Promise<SettlementRunResponse> {
    await this.requireAdmin(request);
    if (!UUID.test(fixtureId)) throw new NotFoundException(NO_FIXTURE);
    const outcome = await this.settlement.settleFixture(fixtureId.toLowerCase());
    if (outcome.kind === 'unknown_fixture') throw new NotFoundException(NO_FIXTURE);
    if (outcome.kind === 'not_final') {
      const error: ApiError = {
        error: 'conflict',
        message: `The fixture is ${outcome.status}; nothing to settle yet.`,
      };
      throw new ConflictException(error);
    }
    return {
      run_id: outcome.runId,
      settled: outcome.settled,
      void: outcome.voided,
      unchanged: outcome.unchanged,
    };
  }

  @Post('settlements/run')
  @HttpCode(200)
  async run(
    @Req() request: FastifyRequest,
  ): Promise<{ fixtures: number; settled: number; void: number }> {
    await this.requireAdmin(request);
    const totals = await this.settlement.settleDue();
    return { fixtures: totals.fixtures, settled: totals.settled, void: totals.voided };
  }

  private async requireAdmin(request: FastifyRequest): Promise<void> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) {
      const error: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
      throw new UnauthorizedException(error);
    }
    if (!(await this.identity.hasRole(user.id, 'admin'))) {
      const error: ApiError = {
        error: 'unauthenticated',
        message: 'Settlement needs the admin role.',
      };
      throw new ForbiddenException(error);
    }
  }
}
