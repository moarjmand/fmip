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
import type {
  ApiError,
  AuthUser,
  TranslationCheckOverride,
  TranslationRequest,
  TranslationReviewRefusal,
  TranslationReviewRequest,
} from '@fmip/contracts';
import { ROLE_REFUSALS } from '@fmip/contracts';
import { TRANSLATION_CHECKS, TRANSLATION_FIELDS } from '@fmip/contracts/translation-checks';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PostgresTranslationsAdminStore } from './internal/translations-admin-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NO_ARTICLE: ApiError = { error: 'not_found', message: 'No such article.' };
const MAX_TEXT = 2000;
const MAX_REASON = 500;

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
    if (!isEditor && !isAdmin) throw new ForbiddenException(ROLE_REFUSALS.editor);
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

  /**
   * A reviewer's reasons for passing failing checks (T-1012, D-131): each
   * names one check on one field and says why, at most one per pair.
   */
  private static overrides(body: TranslationReviewRequest | undefined): TranslationCheckOverride[] {
    const raw: unknown = body?.overrides;
    if (raw === undefined || raw === null) return [];
    if (!Array.isArray(raw) || raw.length > TRANSLATION_CHECKS.length * TRANSLATION_FIELDS.length) {
      throw TranslationsAdminController.bad(
        'overrides must be a list of { check, field, reason }.',
      );
    }
    const seen = new Set<string>();
    return raw.map((item: unknown) => {
      const entry = (item ?? {}) as Record<string, unknown>;
      const check = entry['check'];
      const field = entry['field'];
      if (
        !TRANSLATION_CHECKS.includes(check as never) ||
        !TRANSLATION_FIELDS.includes(field as never)
      ) {
        throw TranslationsAdminController.bad(
          `An override names one of the checks (${TRANSLATION_CHECKS.join(', ')}) on one field (${TRANSLATION_FIELDS.join(', ')}).`,
        );
      }
      const key = `${String(field)}.${String(check)}`;
      if (seen.has(key)) {
        throw TranslationsAdminController.bad(`${key} is overridden twice.`);
      }
      seen.add(key);
      const reason = typeof entry['reason'] === 'string' ? entry['reason'].trim() : '';
      if (reason === '') {
        throw TranslationsAdminController.bad(
          'Passing a failing check needs a reason; it is recorded with your name.',
          { [key]: 'Say why the translation is right anyway.' },
        );
      }
      return {
        check: check as TranslationCheckOverride['check'],
        field: field as TranslationCheckOverride['field'],
        reason: reason.slice(0, MAX_REASON),
      };
    });
  }

  @Post('articles/:id/translations/:language/review')
  @HttpCode(204)
  async review(
    @Param('id') articleId: string,
    @Param('language') language: string,
    @Body() body: TranslationReviewRequest | undefined,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.editor(request);
    const overrides = TranslationsAdminController.overrides(body);
    if (!UUID.test(articleId) || !LANGUAGE.test(language)) throw new NotFoundException(NO_ARTICLE);
    const outcome = await this.store.review(articleId.toLowerCase(), language, user.id, overrides);
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
      case 'checks_fail':
        // Every failure at once, each beside the field it concerns, so the
        // reviewer fixes or explains them all in one pass.
        throw new BadRequestException({
          error: 'validation',
          message: `${outcome.failures.length} automatic check${outcome.failures.length === 1 ? '' : 's'} fail${outcome.failures.length === 1 ? 's' : ''} on this translation. Ask for a new version, or record why each one is right anyway.`,
          fields: Object.fromEntries(
            outcome.failures.map((failure) => [
              `${failure.field}.${failure.check}`,
              failure.detail,
            ]),
          ),
          checks: outcome.failures,
        } satisfies TranslationReviewRefusal);
      case 'not_failing':
        throw TranslationsAdminController.bad(
          `The ${outcome.override.check} check on the ${outcome.override.field} does not fail; there is nothing to pass with a reason.`,
        );
    }
  }
}
