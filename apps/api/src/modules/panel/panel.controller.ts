import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpException,
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
  MatchPanelPage,
  PanelPermission,
  PanelPost,
  PanelRefusal,
  SubmitPanelPostRequest,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { MAX_POST_LENGTH, PanelService } from './panel.service';

const NO_MATCH: ApiError = { error: 'not_found', message: 'No such match.' };
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };

/**
 * What each refusal says to the person it refuses.
 *
 * Keyed by `PanelRefusal` rather than by `string`, so that adding a refusal to
 * the contract and forgetting the words for it does not compile. A member
 * refused with no explanation is the failure this whole endpoint exists to
 * avoid; it should not be one line away.
 */
const REFUSAL_TEXT: Record<PanelRefusal, string> = {
  not_signed_in: 'Sign in to continue.',
  not_approved: 'Posting here needs an approved contributor grant. Reading is open to everybody.',
  paused: 'Your contributor approval is paused. The moderator who paused it gave a reason.',
  withdrawn:
    'Your contributor approval was withdrawn. The moderator who withdrew it gave a reason.',
  restricted: 'A moderation restriction stops you posting here.',
};

/**
 * The public match discussion (blueprint 10.2, T-251).
 *
 * **`GET /fixtures/:id/panel` takes no session and asks for none.** A guest
 * reads, which is half the acceptance criterion and is easiest to get wrong by
 * accident: one `viewer(request)` call at the top of the method would have made
 * the panel private without anybody deciding to.
 *
 * **The other half is that a refusal has words.** A member who cannot post is
 * told which of the four reasons applies and, when it is `not_approved`, what
 * they still need. A hidden compose box would have been a gate too, and a worse
 * one — the member would not know there was anything to ask about.
 */
@Controller('fixtures/:id/panel')
export class PanelController {
  constructor(
    private readonly panel: PanelService,
    private readonly identity: IdentityService,
  ) {}

  /** The viewer, or null. Never throws: this controller has a public half. */
  private async viewer(request: FastifyRequest): Promise<AuthUser | null> {
    return this.identity.authenticate(parseCookies(request.headers.cookie)[SESSION_COOKIE]);
  }

  @Get()
  async read(
    @Param('id') fixtureId: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<MatchPanelPage> {
    const n = Number.parseInt(limit ?? '', 10);
    const page = await this.panel.panel(
      fixtureId,
      cursor,
      Number.isInteger(n) && n > 0 ? n : undefined,
    );
    if (page === null) throw new NotFoundException(NO_MATCH);
    return page;
  }

  /**
   * The viewer's own half, deliberately a second request.
   *
   * Keeping it out of the panel means the panel is the same bytes for everybody
   * and can be cached as a public document. A `can_post` field inside it would
   * have made every public read viewer-specific to save one request.
   */
  @Get('permission')
  async permission(
    @Param('id') fixtureId: string,
    @Req() request: FastifyRequest,
  ): Promise<PanelPermission> {
    return this.panel.permissionFor(await this.viewer(request), fixtureId);
  }

  @Post()
  @HttpCode(201)
  async write(
    @Param('id') fixtureId: string,
    @Body() body: SubmitPanelPostRequest,
    @Req() request: FastifyRequest,
  ): Promise<PanelPost> {
    const user = await this.viewer(request);
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);

    const text = typeof body?.body === 'string' ? body.body.trim() : '';
    if (text === '') {
      throw new BadRequestException({
        error: 'validation',
        message: 'Write something first.',
      } satisfies ApiError);
    }
    if (text.length > MAX_POST_LENGTH) {
      throw new BadRequestException({
        error: 'validation',
        message: `A post is at most ${MAX_POST_LENGTH} characters.`,
      } satisfies ApiError);
    }
    if (!(await this.panel.fixtureExists(fixtureId))) throw new NotFoundException(NO_MATCH);

    const outcome = await this.panel.post(user, fixtureId, text);
    if (outcome.ok && outcome.post !== undefined) return outcome.post;

    // 429 for the ceiling, 403 for a judgement. They are different answers: one
    // says "not now", the other says "not you", and a client that retried the
    // second would keep asking a question already answered.
    if (outcome.tooMany === true) {
      throw new HttpException(
        {
          error: 'rate_limited',
          message: 'You have posted a lot in the last hour. Try again shortly.',
        } satisfies ApiError,
        429,
      );
    }
    throw new ForbiddenException({
      error: 'validation',
      message: REFUSAL_TEXT[outcome.refusal ?? 'not_approved'],
    } satisfies ApiError);
  }

  /**
   * The author taking their own post down.
   *
   * A moderator's removal is not here: that is a moderation decision, it belongs
   * in the moderation queue with an actor and a reason beside it (T-212), and
   * putting a second removal path on this controller would leave two modules
   * writing the same tombstone.
   */
  @Delete(':postId')
  @HttpCode(204)
  async remove(@Param('postId') postId: string, @Req() request: FastifyRequest): Promise<void> {
    const user = await this.viewer(request);
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    // Somebody else's post, an already-removed one, or one that never existed
    // are all 404. Distinguishing them would answer "does this post exist" for
    // anybody who guessed an id.
    if (!(await this.panel.removeOwn(postId, user.id))) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'No post of yours with that id.',
      } satisfies ApiError);
    }
  }
}
