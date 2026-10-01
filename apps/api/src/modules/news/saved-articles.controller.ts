import {
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import { type ApiError, SAVED_ARTICLES_LIMIT, type SavedArticlesResponse } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PostgresSavedArticlesStore } from './internal/saved-articles-store';
import { localeOf } from '../localised-names/localised-names.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NO_STORY: ApiError = { error: 'not_found', message: 'No such story.' };
const FULL: ApiError = {
  error: 'conflict',
  message: `Your saved list holds ${SAVED_ARTICLES_LIMIT} stories. Remove one to save another.`,
};

/**
 * Saved articles (blueprint 3.3 and 2.1, T-842): the member's own list, and
 * nobody else's -- every route is `/me`, a session is required, and nothing
 * here is readable about another member. Saving takes the story's promoted
 * original from a publisher still carried (D-061); a story that has none is
 * a 404, as on the story page.
 */
@Controller('me/saved-articles')
export class SavedArticlesController {
  constructor(
    private readonly identity: IdentityService,
    private readonly saved: PostgresSavedArticlesStore,
  ) {}

  private async member(request: FastifyRequest): Promise<string> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    return user.id;
  }

  /** `locale` is the reader's (D-178): a row from a source not shown in it says so. */
  private async answer(userId: string, locale: string | null): Promise<SavedArticlesResponse> {
    return {
      saved: await this.saved.list(userId, SAVED_ARTICLES_LIMIT, locale),
      limit: SAVED_ARTICLES_LIMIT,
    };
  }

  @Get()
  async list(
    @Req() request: FastifyRequest,
    @Query('locale') locale: unknown,
  ): Promise<SavedArticlesResponse> {
    return this.answer(await this.member(request), localeOf(locale));
  }

  @Put(':storyId')
  async save(
    @Param('storyId') storyId: string,
    @Req() request: FastifyRequest,
    @Query('locale') rawLocale: unknown,
  ): Promise<SavedArticlesResponse> {
    const userId = await this.member(request);
    const locale = localeOf(rawLocale);
    if (!UUID.test(storyId)) throw new NotFoundException(NO_STORY);
    const outcome = await this.saved.save(
      userId,
      storyId.toLowerCase(),
      SAVED_ARTICLES_LIMIT,
      locale,
    );
    if (outcome === 'unknown_story') throw new NotFoundException(NO_STORY);
    if (outcome === 'full') throw new ConflictException(FULL);
    return this.answer(userId, locale);
  }

  @Delete(':storyId')
  @HttpCode(200)
  async remove(
    @Param('storyId') storyId: string,
    @Req() request: FastifyRequest,
    @Query('locale') locale: unknown,
  ): Promise<SavedArticlesResponse> {
    const userId = await this.member(request);
    if (UUID.test(storyId)) await this.saved.remove(userId, storyId.toLowerCase());
    return this.answer(userId, localeOf(locale));
  }
}
