import {
  BadRequestException,
  Body,
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
import type {
  ApiError,
  FounderAnalysisResponse,
  FounderAnalysisVersion,
  FounderOutcome,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { FounderAnalysisService } from './founder.service';
import { type PublishRequest, validatePublish } from './internal/validate';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOT_FOUND: ApiError = { error: 'not_found', message: 'No such fixture.' };
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };

/**
 * `/fixtures/:id/founder-analysis` (T-131, blueprint 6.5).
 *
 * Reading is public — it is one of the three things a reader comes for.
 * Writing needs the `founder` role, not `admin`: an administrator can change
 * coverage and suspend accounts, and none of that should carry the right to
 * publish under the founder's name. The role list has had `founder` in it since
 * T-040 for exactly this.
 */
@Controller('fixtures/:fixtureId/founder-analysis')
export class FounderAnalysisController {
  constructor(
    private readonly analyses: FounderAnalysisService,
    private readonly identity: IdentityService,
  ) {}

  @Get()
  async read(@Param('fixtureId') fixtureId: string): Promise<FounderAnalysisResponse> {
    if (!UUID.test(fixtureId)) throw new NotFoundException(NOT_FOUND);
    const response = await this.analyses.forFixture(fixtureId.toLowerCase());
    if (response === null) throw new NotFoundException(NOT_FOUND);
    return response;
  }

  @Post()
  @HttpCode(201)
  async publish(
    @Param('fixtureId') fixtureId: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<FounderAnalysisVersion> {
    const author = await this.requireFounder(request);
    if (!UUID.test(fixtureId)) throw new NotFoundException(NOT_FOUND);

    const parsed = validatePublish(body);
    if ('fields' in parsed) {
      throw new BadRequestException({
        error: 'validation',
        message: 'The analysis is not valid.',
        fields: parsed.fields,
      } satisfies ApiError);
    }

    const outcome = await this.analyses.publish({
      fixtureId: fixtureId.toLowerCase(),
      authorId: author,
      predictedOutcome: parsed.value.predicted_outcome as FounderOutcome,
      predictedScore: parsed.value.predicted_score,
      confidence: parsed.value.confidence,
      reasoning: parsed.value.reasoning,
      lineupImpact: parsed.value.lineup_impact,
      keyPlayers: parsed.value.key_players,
      formAndContext: parsed.value.form_and_context,
    });

    if (outcome.kind === 'unknown_fixture') throw new NotFoundException(NOT_FOUND);
    if (outcome.kind === 'locked') {
      // Not a validation error: the request was well formed and arrived late.
      throw new ConflictException({
        error: 'conflict',
        message: 'The match has kicked off. An analysis cannot be published or updated after that.',
      } satisfies ApiError);
    }
    return outcome.version;
  }

  /** Returns the author's id. `founder`, deliberately not `admin`. */
  private async requireFounder(request: FastifyRequest): Promise<string> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'founder'))) {
      throw new ForbiddenException({
        error: 'unauthenticated',
        message: "Publishing the founder's analysis needs the founder role.",
      } satisfies ApiError);
    }
    return user.id;
  }
}

export type { PublishRequest };
