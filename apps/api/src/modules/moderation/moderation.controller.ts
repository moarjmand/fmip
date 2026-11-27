import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
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
  AppealNote,
  AuthUser,
  OwnStandingResponse,
  Report,
  SubmitReportRequest,
  SubmitReportResponse,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { type AppealResult, ModerationService } from './moderation.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };

/** An appeal's refusal as HTTP: the same for a sanction and a decision (T-1973). */
function answer(result: AppealResult, what: 'sanction' | 'decision'): void {
  if (result.ok) return;
  if (result.reason === 'invalid') {
    throw new BadRequestException({
      error: 'validation',
      message: 'The appeal is not valid.',
      fields: result.fields,
    } satisfies ApiError);
  }
  if (result.reason === 'already_appealed') {
    // Once (T-1973): the platform rules' "appealed once, in writing". The
    // first appeal is the one kept with the decision.
    throw new ConflictException({
      error: 'conflict',
      message:
        what === 'sanction'
          ? 'You have already appealed this restriction.'
          : 'You have already appealed this decision.',
    } satisfies ApiError);
  }
  // Somebody else's is "not found" rather than "forbidden": a 403 would
  // confirm that a particular id exists and belongs to a member the caller
  // is not.
  throw new NotFoundException({
    error: 'not_found',
    message:
      what === 'sanction'
        ? 'No such sanction on your account.'
        : 'No such decision on your account that can be appealed.',
  } satisfies ApiError);
}

/**
 * Reporting and a member's own standing (blueprint 10.4, T-211).
 *
 * The moderator's half — the queue, the decisions, the sanctions — is T-212 and
 * lives behind the admin gate. What is here is what a *member* can do: report
 * somebody, see what has been done to them, and appeal it.
 */
@Controller()
export class ModerationController {
  constructor(
    private readonly moderation: ModerationService,
    private readonly identity: IdentityService,
  ) {}

  private async requireViewer(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return user;
  }

  /**
   * File a report. A session is the only requirement — see the service for why
   * an unverified or a sanctioned member may still report somebody.
   *
   * 200 with `filed` (T-1973): `false` when this reporter already has an open
   * report about this subject, so the member can be told that what they wrote
   * now was not added, rather than "sent".
   */
  @Post('reports')
  @HttpCode(200)
  async file(
    @Body() body: SubmitReportRequest,
    @Req() request: FastifyRequest,
  ): Promise<SubmitReportResponse> {
    const viewer = await this.requireViewer(request);
    const result = await this.moderation.report(viewer.id, body ?? ({} as SubmitReportRequest));
    if (result.ok) return { filed: result.filed };

    switch (result.reason) {
      case 'invalid':
        throw new BadRequestException({
          error: 'validation',
          message: 'The report is not valid.',
          fields: result.fields,
        } satisfies ApiError);
      case 'unknown_subject':
        throw new NotFoundException({
          error: 'not_found',
          message: 'No such member.',
        } satisfies ApiError);
      case 'self':
        throw new BadRequestException({
          error: 'validation',
          message: 'That is your own account.',
        } satisfies ApiError);
    }
  }

  /** What this member has reported. Never what anybody has reported about them. */
  @Get('me/reports')
  async mine(@Req() request: FastifyRequest): Promise<{ reports: Report[] }> {
    const viewer = await this.requireViewer(request);
    return { reports: await this.moderation.ownReports(viewer.id) };
  }

  /**
   * What has been done to this member.
   *
   * Always readable by them. A restriction a member cannot see is one they
   * cannot appeal, and blueprint 10.4 asks for appeals.
   */
  @Get('me/standing')
  async standing(@Req() request: FastifyRequest): Promise<OwnStandingResponse> {
    const viewer = await this.requireViewer(request);
    const [sanctions, decisions] = await Promise.all([
      this.moderation.standing(viewer.id),
      this.moderation.ownDecisions(viewer.id),
    ]);
    return { sanctions, decisions };
  }

  @Post('me/sanctions/:id/appeal')
  @HttpCode(204)
  async appeal(
    @Param('id') id: string,
    @Body() body: { body?: string },
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    answer(await this.moderation.appeal(viewer.id, id, body?.body ?? ''), 'sanction');
  }

  /**
   * A decision about the member that carries no sanction -- a warning,
   * content removed -- appealed once, like a sanction (T-1973; the platform
   * rules: "every decision can be appealed once, in writing").
   */
  @Post('me/decisions/:id/appeal')
  @HttpCode(204)
  async appealDecision(
    @Param('id') id: string,
    @Body() body: { body?: string },
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    answer(await this.moderation.appealDecision(viewer.id, id, body?.body ?? ''), 'decision');
  }

  @Get('me/sanctions/:id/appeal')
  async notes(
    @Param('id') id: string,
    @Req() request: FastifyRequest,
  ): Promise<{ notes: AppealNote[] }> {
    const viewer = await this.requireViewer(request);
    const mine = (await this.moderation.standing(viewer.id)).some((s) => s.id === id);
    if (!mine) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'No such sanction on your account.',
      } satisfies ApiError);
    }
    return { notes: await this.moderation.appealNotes(id) };
  }
}
