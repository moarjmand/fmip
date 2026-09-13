import {
  BadRequestException,
  Body,
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
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { ModerationService } from './moderation.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };

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
   */
  @Post('reports')
  @HttpCode(204)
  async file(@Body() body: SubmitReportRequest, @Req() request: FastifyRequest): Promise<void> {
    const viewer = await this.requireViewer(request);
    const result = await this.moderation.report(viewer.id, body ?? ({} as SubmitReportRequest));
    if (result.ok) return;

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
    return { sanctions: await this.moderation.standing(viewer.id) };
  }

  @Post('me/sanctions/:id/appeal')
  @HttpCode(204)
  async appeal(
    @Param('id') id: string,
    @Body() body: { body?: string },
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const viewer = await this.requireViewer(request);
    const result = await this.moderation.appeal(viewer.id, id, body?.body ?? '');
    if (result.ok) return;

    if (result.reason === 'invalid') {
      throw new BadRequestException({
        error: 'validation',
        message: 'The appeal is not valid.',
        fields: result.fields,
      } satisfies ApiError);
    }
    // A sanction on somebody else is "not found" rather than "forbidden": a 403
    // would confirm that a particular id exists and belongs to a member the
    // caller is not.
    throw new NotFoundException({
      error: 'not_found',
      message: 'No such sanction on your account.',
    } satisfies ApiError);
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
