import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, AuthUser, TranslationRequest } from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PostgresTranslationsAdminStore } from './internal/translations-admin-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_AN_EDITOR: ApiError = {
  error: 'validation',
  message: 'This needs the editor or administrator role.',
};
const NO_ARTICLE: ApiError = { error: 'not_found', message: 'No such article.' };
const MAX_TEXT = 2000;

/**
 * A person's language version of an article (T-304, blueprint 13): `POST
 * /admin/articles/:id/translations` writes one as a new version, `POST
 * .../translations/:language/review` has a second person approve it as
 * another. Editors and administrators, because that is the role that exists;
 * the review is refused to the author, because a translation reviewed by the
 * person who wrote it is not reviewed (D-066).
 */
@Controller('admin')
export class TranslationsAdminController {
  constructor(
    private readonly store: PostgresTranslationsAdminStore,
    private readonly identity: IdentityService,
  ) {}

  private async editor(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    const [isEditor, isAdmin] = await Promise.all([
      this.identity.hasRole(user.id, 'editor'),
      this.identity.hasRole(user.id, 'admin'),
    ]);
    if (!isEditor && !isAdmin) throw new ForbiddenException(NOT_AN_EDITOR);
    return user;
  }

  private static bad(message: string, fields?: Record<string, string>): BadRequestException {
    return new BadRequestException({ error: 'validation', message, ...(fields ? { fields } : {}) });
  }

  private static text(value: unknown, name: string, required: boolean): string | null {
    if (value === undefined || value === null) {
      if (required)
        throw TranslationsAdminController.bad(`${name} is required.`, { [name]: 'Required.' });
      return null;
    }
    if (typeof value !== 'string') throw TranslationsAdminController.bad(`${name} must be text.`);
    const text = value.trim();
    if (text === '') {
      if (required)
        throw TranslationsAdminController.bad(`${name} is required.`, { [name]: 'Required.' });
      return null;
    }
    return text.slice(0, MAX_TEXT);
  }

  @Post('articles/:id/translations')
  @HttpCode(201)
  async translate(
    @Param('id') articleId: string,
    @Body() body: TranslationRequest,
    @Req() request: FastifyRequest,
  ): Promise<{ version_number: number }> {
    const user = await this.editor(request);
    const language = typeof body?.language === 'string' ? body.language.trim() : '';
    if (!LANGUAGE.test(language)) {
      throw TranslationsAdminController.bad('language must be a language tag.', {
        language: 'A BCP 47 tag, like fa or pt-BR.',
      });
    }
    const headline = TranslationsAdminController.text(body?.headline, 'headline', true)!;
    const summary = TranslationsAdminController.text(body?.summary, 'summary', false);
    const byline = TranslationsAdminController.text(body?.byline, 'byline', false);
    if (!UUID.test(articleId)) throw new NotFoundException(NO_ARTICLE);

    const outcome = await this.store.translate(articleId.toLowerCase(), user.id, {
      language,
      headline,
      summary,
      byline,
    });
    switch (outcome.kind) {
      case 'written':
        return { version_number: outcome.versionNumber };
      case 'no_article':
        throw new NotFoundException(NO_ARTICLE);
      case 'publisher_language':
        throw TranslationsAdminController.bad(
          `The publisher already writes this article in ${language}; a translation into it would be a second original.`,
        );
      case 'rights':
        throw TranslationsAdminController.bad(
          'This source grants the headline only; a translation cannot carry a summary it does not have (D-061).',
          { summary: 'Not granted by the source.' },
        );
    }
  }

  @Post('articles/:id/translations/:language/review')
  @HttpCode(204)
  async review(
    @Param('id') articleId: string,
    @Param('language') language: string,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.editor(request);
    if (!UUID.test(articleId) || !LANGUAGE.test(language)) throw new NotFoundException(NO_ARTICLE);
    const outcome = await this.store.review(articleId.toLowerCase(), language, user.id);
    switch (outcome.kind) {
      case 'reviewed':
        return;
      case 'nothing_to_review':
        throw new NotFoundException({
          error: 'not_found',
          message: `There is no ${language} translation to review.`,
        } satisfies ApiError);
      case 'already_reviewed':
        throw TranslationsAdminController.bad(`The ${language} translation is already reviewed.`);
      case 'same_person':
        throw TranslationsAdminController.bad(
          'A translation is reviewed by a second fluent speaker, not by the person who wrote it.',
        );
    }
  }
}
