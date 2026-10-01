import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { ApiError, ArticleImageOverrideRequest, AuthUser } from '@fmip/contracts';
import { ROLE_REFUSALS } from '@fmip/contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PostgresNewsImageStore } from './internal/news-image-store';
import { readMedia } from './internal/news-media';
import { MEDIA_ROOT, NewsImagesService } from './news-images.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(?:jpg|png|webp)$/;
const MAX_TEXT = 2000;

/**
 * `GET /media/news/:file` (T-1322, D-177): a stored news photo, from our own
 * volume, while a reader may see it -- stored, not hidden by an editor, from
 * a source whose licence still covers photos. A file name is never reused,
 * so the answer is cacheable for a year and immutable; anything else is a
 * 404 that is not cached, so a hidden photo stops being served at once.
 */
@Controller('media/news')
export class NewsMediaController {
  constructor(
    private readonly store: PostgresNewsImageStore,
    @Inject(MEDIA_ROOT) private readonly root: string | null,
  ) {}

  @Get(':file')
  async file(@Param('file') file: string, @Res() reply: FastifyReply): Promise<void> {
    const missing = (): void => {
      void reply
        .status(404)
        .header('cache-control', 'no-store')
        .send({ error: 'not_found', message: 'No such image.' } satisfies ApiError);
    };
    if (this.root === null || !FILE.test(file)) return missing();
    const image = await this.store.servable(`news/${file}`);
    if (image === null) return missing();
    const bytes = await readMedia(this.root, image.file_key);
    if (bytes === null) return missing();
    void reply
      .status(200)
      .header('content-type', image.content_type)
      .header('cache-control', 'public, max-age=31536000, immutable')
      .header('x-content-type-options', 'nosniff')
      .header('content-security-policy', "default-src 'none'")
      .send(bytes);
  }
}

/**
 * `POST /admin/articles/:id/image` (T-1322, D-177): an editor shows or hides
 * one article's photo, with a reason; the decision and the previous value
 * are an audit row (rule 10). Editors and administrators.
 */
@Controller('admin')
export class NewsImageAdminController {
  constructor(
    private readonly images: NewsImagesService,
    private readonly identity: IdentityService,
  ) {}

  private async editor(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) {
      throw new UnauthorizedException({
        error: 'unauthenticated',
        message: 'Sign in to continue.',
      } satisfies ApiError);
    }
    const [isEditor, isAdmin] = await Promise.all([
      this.identity.hasRole(user.id, 'editor'),
      this.identity.hasRole(user.id, 'admin'),
    ]);
    if (!isEditor && !isAdmin) throw new ForbiddenException(ROLE_REFUSALS.editor);
    return user;
  }

  @Post('articles/:id/image')
  @HttpCode(204)
  async override(
    @Param('id') articleId: string,
    @Body() body: ArticleImageOverrideRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.editor(request);
    const action = body?.action;
    if (action !== 'show' && action !== 'hide') {
      throw new BadRequestException({
        error: 'validation',
        message: 'Say "show" or "hide".',
      } satisfies ApiError);
    }
    const reason = typeof body?.reason === 'string' ? body.reason.trim() : '';
    if (reason === '') {
      throw new BadRequestException({
        error: 'validation',
        message: 'Say why. This is recorded against the article.',
      } satisfies ApiError);
    }
    if (!UUID.test(articleId)) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'No such article.',
      } satisfies ApiError);
    }
    const outcome = await this.images.override(
      articleId,
      user.id,
      action,
      reason.slice(0, MAX_TEXT),
    );
    if (outcome.ok) return;
    if (outcome.error === 'not_found') {
      throw new NotFoundException({
        error: 'not_found',
        message: outcome.message,
      } satisfies ApiError);
    }
    throw new ConflictException({ error: 'conflict', message: outcome.message } satisfies ApiError);
  }
}
