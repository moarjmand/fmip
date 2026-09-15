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
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiError,
  AuthUser,
  PanelDecisionRequest,
  PanelListResponse,
  PanelRecord,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PostgresPanelAdminStore, type PanelFilter } from './internal/panel-admin-store';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_AN_OPERATOR: ApiError = {
  error: 'validation',
  message: 'This needs the moderator or administrator role.',
};
const NO_MATCH: ApiError = { error: 'not_found', message: 'No such match.' };

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_REASON = 2000;

/**
 * Which matches have a public discussion (blueprint 10.2, T-253).
 *
 * **`moderator` or `admin`**, the same pair the moderation queue uses
 * (blueprint 7.3). Opening a panel is not an editorial nicety: it creates a
 * room that can be used to reach the public, and the person who has to clean it
 * up afterwards is the same person.
 *
 * **Every write records actor, time and reason in `audit_log`, in the same
 * transaction as the change** (rule 10, D-046). That is the acceptance
 * criterion, so the tests read the rows back rather than stopping at the status
 * code.
 */
@Controller('admin')
export class PanelAdminController {
  constructor(
    private readonly store: PostgresPanelAdminStore,
    private readonly identity: IdentityService,
  ) {}

  private async operator(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    const [isModerator, isAdmin] = await Promise.all([
      this.identity.hasRole(user.id, 'moderator'),
      this.identity.hasRole(user.id, 'admin'),
    ]);
    if (!isModerator && !isAdmin) throw new ForbiddenException(NOT_AN_OPERATOR);
    return user;
  }

  private static reason(given: unknown): string {
    const text = typeof given === 'string' ? given.trim() : '';
    if (text === '') {
      throw new BadRequestException({
        error: 'validation',
        message: 'Say why. This is recorded against the match.',
      } satisfies ApiError);
    }
    return text.slice(0, MAX_REASON);
  }

  @Get('panels')
  async list(
    @Req() request: FastifyRequest,
    @Query('state') state?: string,
    @Query('limit') limit?: string,
  ): Promise<PanelListResponse> {
    await this.operator(request);
    // An unknown filter is read as `all` rather than refused: a mistyped query
    // string should show an operator everything, not an error page.
    const filter: PanelFilter = state === 'open' || state === 'closed' ? state : 'all';
    const n = Number.parseInt(limit ?? '', 10);
    const capped = Number.isInteger(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;

    const rows = await this.store.list(filter, capped);
    return {
      generated_at: new Date().toISOString(),
      panels: rows.map((row): PanelRecord => ({
        fixture_id: row.fixture_id,
        // A fixture whose participants are not yet loaded is still a fixture.
        // Saying "unknown" beats hiding the panel from the person who has to
        // decide about it (rule 3).
        home: row.home ?? 'Unknown',
        away: row.away ?? 'Unknown',
        kickoff_at: row.kickoff_at.toISOString(),
        opened_by: row.opened_by,
        reason: row.reason,
        opened_at: row.opened_at.toISOString(),
        closed_at: row.closed_at?.toISOString() ?? null,
        closed_by: row.closed_by,
        close_reason: row.close_reason,
        posts: Number(row.posts),
      })),
    };
  }

  /**
   * Open a discussion on this match, or reopen a closed one.
   *
   * The same call for both, because it is the same decision: this match should
   * have a public discussion. A reopening records why it is open *now*, not why
   * it was opened a month ago, and the audit row keeps the old state beside the
   * new one.
   */
  @Post('fixtures/:id/panel')
  @HttpCode(204)
  async open(
    @Param('id') fixtureId: string,
    @Body() body: PanelDecisionRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.operator(request);
    const reason = PanelAdminController.reason(body?.reason);
    if (!(await this.store.fixtureExists(fixtureId))) throw new NotFoundException(NO_MATCH);

    if ((await this.store.open(fixtureId, user.id, reason)) === 'already') {
      throw new BadRequestException({
        error: 'validation',
        message: 'This match already has an open discussion.',
      } satisfies ApiError);
    }
  }

  /**
   * Close it. The posts stay readable.
   *
   * Not a `DELETE`, and the method is the argument: nothing is deleted. Taking
   * the words down when the argument ends would rewrite a record people were
   * told was public.
   */
  @Post('fixtures/:id/panel/close')
  @HttpCode(204)
  async close(
    @Param('id') fixtureId: string,
    @Body() body: PanelDecisionRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.operator(request);
    const reason = PanelAdminController.reason(body?.reason);
    if (!(await this.store.close(fixtureId, user.id, reason))) {
      // No panel, or one already closed. Either way there is nothing to close,
      // and inventing one to close would be worse than saying so.
      throw new NotFoundException({
        error: 'not_found',
        message: 'This match has no open discussion.',
      } satisfies ApiError);
    }
  }
}
