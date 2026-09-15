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
  ContributorGrant,
  ContributorListResponse,
  ContributorStatusResponse,
  GrantContributorRequest,
  GrantEventRequest,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { ContributorService, type GrantOutcome } from './contributor.service';

const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_A_MODERATOR: ApiError = {
  error: 'validation',
  message: 'This needs the moderator or administrator role.',
};

/** The rules an approved contributor accepts (`13-policy.md` §5). */
const CONTRIBUTOR_RULES = 'contributor-rules@1.0.0';

const MAX_REASON = 2000;

/**
 * Contributor eligibility and contributor approval (blueprint 9.4 and 10.2,
 * T-250).
 *
 * **Two audiences, one controller, and the split is by route prefix.**
 * `GET /me/contributor` is the member's own view of both halves — what they
 * still need, and what was decided about them. Everything under
 * `/admin/contributors` is the approver's, and needs `moderator` or `admin`,
 * the same pair the moderation queue uses (blueprint 7.3).
 *
 * **Approving is a `POST` that carries a reason, and the reason is required.**
 * A grant with no reason is one nobody can review later, which is the same
 * argument `moderation_decision.reason` makes one layer down — and here the
 * person it is about is told it, so a blank one would be an explanation that
 * explains nothing.
 */
@Controller()
export class ContributorController {
  constructor(
    private readonly contributors: ContributorService,
    private readonly identity: IdentityService,
  ) {}

  private async viewer(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return user;
  }

  private async approver(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.viewer(request);
    const [isModerator, isAdmin] = await Promise.all([
      this.identity.hasRole(user.id, 'moderator'),
      this.identity.hasRole(user.id, 'admin'),
    ]);
    if (!isModerator && !isAdmin) throw new ForbiddenException(NOT_A_MODERATOR);
    return user;
  }

  private static reason(given: unknown): string {
    const text = typeof given === 'string' ? given.trim() : '';
    if (text === '') {
      throw new BadRequestException({
        error: 'validation',
        message: 'Say why. This is recorded, and the member is told it.',
      } satisfies ApiError);
    }
    return text.slice(0, MAX_REASON);
  }

  /**
   * Turns a refusal into a sentence. The database decided it (`PL013`) and the
   * hint says which refusal it was; this only chooses the words and the status.
   */
  private static settle(outcome: GrantOutcome): ContributorGrant {
    if (outcome.ok) return outcome.grant;
    const messages: Record<string, ApiError> = {
      unknown_member: { error: 'not_found', message: 'No such member.' },
      no_grant: {
        error: 'not_found',
        message: 'This member holds no contributor grant. Approving them is a new grant.',
      },
      already_granted: {
        error: 'validation',
        message: 'This member already holds a contributor grant.',
      },
      withdrawn: {
        error: 'validation',
        message: 'That grant was withdrawn. A new approval is a new grant.',
      },
      paused: { error: 'validation', message: 'That grant is already paused.' },
      active: { error: 'validation', message: 'That grant is not paused.' },
    };
    const error = messages[outcome.why] ?? {
      error: 'validation',
      message: 'That change cannot be made to this grant.',
    };
    if (error.error === 'not_found') throw new NotFoundException(error);
    throw new BadRequestException(error);
  }

  /**
   * The member's own view: what they still need, and what was decided.
   *
   * Both are sent even when one of them settles the matter. A contributor whose
   * grant was paused is still shown their eligibility, because the pause was
   * somebody's judgement and the numbers are how they get back to the
   * conversation about it.
   */
  @Get('me/contributor')
  async mine(@Req() request: FastifyRequest): Promise<ContributorStatusResponse> {
    const user = await this.viewer(request);
    const status = await this.contributors.statusOf(user.id, user.username);
    if (status === null)
      throw new NotFoundException({
        error: 'not_found',
        message: 'No such member.',
      } satisfies ApiError);
    return status;
  }

  /** Who an approver might be deciding about, with the four requirements against each. */
  @Get('admin/contributors')
  async candidates(
    @Req() request: FastifyRequest,
    @Query('limit') limit?: string,
  ): Promise<ContributorListResponse> {
    await this.approver(request);
    const n = Number.parseInt(limit ?? '', 10);
    return this.contributors.candidates(Number.isInteger(n) && n > 0 ? n : undefined);
  }

  /** Everything about one member's standing, so nobody decides blind. */
  @Get('admin/contributors/:username')
  async one(
    @Param('username') username: string,
    @Req() request: FastifyRequest,
  ): Promise<ContributorStatusResponse> {
    await this.approver(request);
    const user = await this.identity.userByUsername(username.toLowerCase());
    if (user === null) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'No such member.',
      } satisfies ApiError);
    }
    const status = await this.contributors.statusOf(user.id, user.username);
    if (status === null) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'No such member.',
      } satisfies ApiError);
    }
    return status;
  }

  /**
   * The approval itself (blueprint 10.2's fifth requirement).
   *
   * `rules_version` is not taken from the caller: the server knows which
   * contributor rules are current, and a client that could name an older
   * version could record an acceptance of words nobody is being held to.
   */
  @Post('admin/contributors')
  @HttpCode(201)
  async grant(
    @Body() body: GrantContributorRequest,
    @Req() request: FastifyRequest,
  ): Promise<ContributorGrant> {
    const approver = await this.approver(request);
    const reason = ContributorController.reason(body?.reason);
    const username = typeof body?.username === 'string' ? body.username : '';
    return ContributorController.settle(
      await this.contributors.grant(approver.id, username, reason, CONTRIBUTOR_RULES),
    );
  }

  @Post('admin/contributors/:username/pause')
  @HttpCode(200)
  async pause(
    @Param('username') username: string,
    @Body() body: GrantEventRequest,
    @Req() request: FastifyRequest,
  ): Promise<ContributorGrant> {
    const actor = await this.approver(request);
    const reason = ContributorController.reason(body?.reason);
    return ContributorController.settle(
      await this.contributors.change(actor.id, username, 'paused', reason),
    );
  }

  @Post('admin/contributors/:username/resume')
  @HttpCode(200)
  async resume(
    @Param('username') username: string,
    @Body() body: GrantEventRequest,
    @Req() request: FastifyRequest,
  ): Promise<ContributorGrant> {
    const actor = await this.approver(request);
    const reason = ContributorController.reason(body?.reason);
    return ContributorController.settle(
      await this.contributors.change(actor.id, username, 'resumed', reason),
    );
  }

  /**
   * Withdrawal, which is terminal. A later approval is a new grant with its own
   * approver and its own reason, and the withdrawn one stays where it is.
   */
  @Post('admin/contributors/:username/withdraw')
  @HttpCode(200)
  async withdraw(
    @Param('username') username: string,
    @Body() body: GrantEventRequest,
    @Req() request: FastifyRequest,
  ): Promise<ContributorGrant> {
    const actor = await this.approver(request);
    const reason = ContributorController.reason(body?.reason);
    return ContributorController.settle(
      await this.contributors.change(actor.id, username, 'withdrawn', reason),
    );
  }
}
