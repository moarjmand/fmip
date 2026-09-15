import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiError,
  AuthUser,
  CommunityAnalysesResponse,
  CommunityAnalysisContent,
  CommunityAnalysisWorkspace,
  CommunityConfidence,
  CommunityOutcome,
  CommunitySubmission,
  ReviewAnalysisRequest,
  SaveAnalysisDraftRequest,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { AnalysisService, type WorkOutcome } from './analysis.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_A_REVIEWER: ApiError = {
  error: 'validation',
  message: 'Reviewing analysis needs the editor or administrator role.',
};

const OUTCOMES = new Set(['home', 'draw', 'away']);
const DECISIONS = new Set(['approved', 'changes_requested', 'rejected']);
const MAX_PROSE = 20_000;
const DEFAULT_QUEUE = 50;
const MAX_QUEUE = 200;

/**
 * Community-written analysis (blueprint 10.3, T-261).
 *
 * **Three audiences, and the route prefix says which.** `/fixtures/:id/
 * community-analyses` is public and needs no session — a published analysis is
 * meant to be read. `/me/analyses/*` is the analyst's own workspace.
 * `/admin/analysis-reviews/*` is the editorial queue, and needs `editor` or
 * `admin`.
 *
 * **`editor`, not `moderator`.** Moderation is about conduct; this is about
 * whether a piece of writing is good enough to publish under the platform's
 * name, and blueprint 7.3 keeps them apart. Conflating the two roles would
 * make every moderator an editor by accident.
 */
@Controller()
export class AnalysisController {
  constructor(
    private readonly analysis: AnalysisService,
    private readonly identity: IdentityService,
  ) {}

  private async viewer(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return user;
  }

  private async reviewer(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.viewer(request);
    const [isEditor, isAdmin] = await Promise.all([
      this.identity.hasRole(user.id, 'editor'),
      this.identity.hasRole(user.id, 'admin'),
    ]);
    if (!isEditor && !isAdmin) throw new ForbiddenException(NOT_A_REVIEWER);
    return user;
  }

  /** Every field checked at once, so an analyst fixes one thing and not four. */
  private static content(body: SaveAnalysisDraftRequest): CommunityAnalysisContent {
    const fields: Record<string, string> = {};
    const outcome = String(body?.predicted_outcome ?? '');
    if (!OUTCOMES.has(outcome)) fields.predicted_outcome = 'Must be home, draw or away.';

    const confidence = Number(body?.confidence);
    if (!Number.isInteger(confidence) || confidence < 1 || confidence > 5) {
      fields.confidence = 'Whole numbers from 1 to 5.';
    }
    const reasoning = typeof body?.reasoning === 'string' ? body.reasoning.trim() : '';
    if (reasoning === '') {
      // The line between an analysis and a prediction, and the product already
      // has predictions.
      fields.reasoning = 'Say why. An analysis without reasoning is a prediction.';
    }
    if (reasoning.length > MAX_PROSE) fields.reasoning = `At most ${MAX_PROSE} characters.`;

    const home = body?.predicted_home ?? null;
    const away = body?.predicted_away ?? null;
    if ((home === null) !== (away === null)) {
      fields.predicted_home = 'Give both sides of the score, or neither.';
    }

    if (Object.keys(fields).length > 0) {
      throw new BadRequestException({
        error: 'validation',
        message: 'Some of this needs fixing.',
        fields,
      } satisfies ApiError & { fields: Record<string, string> });
    }

    const optional = (value: unknown): string | null => {
      const text = typeof value === 'string' ? value.trim() : '';
      // Absent means absent, never an empty string pretending to be prose.
      return text === '' ? null : text.slice(0, MAX_PROSE);
    };

    return {
      predicted_outcome: outcome as CommunityOutcome,
      predicted_home: home === null ? null : Number(home),
      predicted_away: away === null ? null : Number(away),
      confidence: confidence as CommunityConfidence,
      reasoning: reasoning.slice(0, MAX_PROSE),
      lineup_impact: optional(body?.lineup_impact),
      key_players: optional(body?.key_players),
      form_and_context: optional(body?.form_and_context),
    };
  }

  /** Turns an outcome into a sentence. The database decided; this chooses words. */
  private static settle(outcome: WorkOutcome): void {
    if (outcome === 'ok') return;
    const errors: Record<string, ApiError> = {
      not_found: { error: 'not_found', message: 'No such analysis.' },
      not_approved: {
        error: 'validation',
        message: 'Writing analysis needs an approved contributor grant.',
      },
      kicked_off: {
        error: 'validation',
        message:
          'This match has kicked off. An analysis cannot be changed once the game is under way.',
      },
      no_draft: { error: 'validation', message: 'There is nothing to submit yet.' },
      already_decided: {
        error: 'validation',
        message: 'That submission already has a decision.',
      },
    };
    const error = errors[outcome] ?? { error: 'validation', message: 'That cannot be done.' };
    if (error.error === 'not_found') throw new NotFoundException(error);
    throw new BadRequestException(error);
  }

  /**
   * Everything published on this match. **No session asked for**: a published
   * analysis is meant to be read, and asking for one would make it private by
   * accident, the same way it would on the panel (T-251).
   */
  @Get('fixtures/:id/community-analyses')
  async published(@Param('id') fixtureId: string): Promise<CommunityAnalysesResponse> {
    return this.analysis.published(fixtureId);
  }

  @Put('me/analyses/:fixtureId')
  @HttpCode(204)
  async saveDraft(
    @Param('fixtureId') fixtureId: string,
    @Body() body: SaveAnalysisDraftRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.viewer(request);
    const content = AnalysisController.content(body);
    AnalysisController.settle(await this.analysis.saveDraft(fixtureId, user.id, content));
  }

  @Get('me/analyses/:fixtureId')
  async workspace(
    @Param('fixtureId') fixtureId: string,
    @Req() request: FastifyRequest,
  ): Promise<CommunityAnalysisWorkspace> {
    const user = await this.viewer(request);
    const workspace = await this.analysis.workspace(fixtureId, user.id);
    if (workspace === null) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'You have not written anything about this match.',
      } satisfies ApiError);
    }
    return workspace;
  }

  @Post('me/analyses/:fixtureId/submit')
  @HttpCode(204)
  async submit(
    @Param('fixtureId') fixtureId: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.viewer(request);
    AnalysisController.settle(await this.analysis.submit(fixtureId, user.id));
  }

  /** What is waiting to be read, oldest first. */
  @Get('admin/analysis-reviews')
  async queue(
    @Req() request: FastifyRequest,
    @Query('limit') limit?: string,
  ): Promise<{ submissions: CommunitySubmission[]; authors: string[]; generated_at: string }> {
    await this.reviewer(request);
    const n = Number.parseInt(limit ?? '', 10);
    const capped = Number.isInteger(n) && n > 0 ? Math.min(n, MAX_QUEUE) : DEFAULT_QUEUE;
    return { ...(await this.analysis.queue(capped)), generated_at: new Date().toISOString() };
  }

  @Post('admin/analysis-reviews/:submissionId')
  @HttpCode(204)
  async review(
    @Param('submissionId') submissionId: string,
    @Body() body: ReviewAnalysisRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.reviewer(request);
    const decision = String(body?.decision ?? '');
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';

    if (!DECISIONS.has(decision)) {
      throw new BadRequestException({
        error: 'validation',
        message: 'Must be approved, changes_requested or rejected.',
      } satisfies ApiError);
    }
    if (reason === '') {
      // Required even for an approval: "why did this get through" is as much a
      // question as "why was this refused", and only one of them is usually
      // asked in time.
      throw new BadRequestException({
        error: 'validation',
        message: 'Say why. A decision with no reason cannot be reviewed.',
      } satisfies ApiError);
    }

    AnalysisController.settle(
      await this.analysis.decide(
        submissionId,
        user.id,
        decision as 'approved' | 'changes_requested' | 'rejected',
        reason.slice(0, MAX_PROSE),
      ),
    );
  }
}
