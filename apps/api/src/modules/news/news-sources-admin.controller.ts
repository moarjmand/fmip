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
  Patch,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import {
  type ApiError,
  type AuthUser,
  NEWS_SOURCE_KINDS,
  NEWS_SOURCE_RIGHTS,
  type NewsFeedPreview,
  type NewsSourceKind,
  type NewsSourceRights,
  type NewsSourcesResponse,
  type NewsSourceWriteResponse,
  ROLE_REFUSALS,
} from '@fmip/contracts';
import type { Transport } from '@fmip/ingestion';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { feedUrlProblem, previewRefusal, probeFeed } from './internal/feed-probe';
import { NEWS_TRANSPORT } from './internal/news-transport';
import {
  type NewsSourceFields,
  PostgresNewsSourcesAdminStore,
} from './internal/news-sources-admin-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LANGUAGE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NO_SOURCE: ApiError = { error: 'not_found', message: 'No such news source.' };
const MAX_NAME = 200;
const MAX_URL = 2000;
const MAX_REASON = 500;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function invalid(fields: Record<string, string>): never {
  throw new BadRequestException({
    error: 'validation',
    message: 'The request is not valid.',
    fields,
  } satisfies ApiError);
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * News sources in the console (T-1015): `GET /admin/news-sources`, `POST
 * /admin/news-sources/preview` (the feed fetched once after its robots.txt,
 * nothing written), `POST /admin/news-sources` (added only when that check
 * passes), `PATCH /admin/news-sources/:id` (a new feed address is checked
 * again) and `POST /admin/news-sources/:id/drop` (a publisher who asks to be
 * dropped is dropped: a reason and nothing else). Administrators only; every
 * write is an `audit_log` row with the reason and the previous value (rule
 * 10). Which publishers to carry is the maintainer's (N-8): nothing here
 * adds one by itself.
 */
@Controller('admin/news-sources')
export class NewsSourcesAdminController {
  constructor(
    private readonly store: PostgresNewsSourcesAdminStore,
    private readonly identity: IdentityService,
    @Inject(NEWS_TRANSPORT) private readonly transport: Transport,
  ) {}

  private async administrator(request: FastifyRequest): Promise<AuthUser> {
    const user = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    if (user === null) throw new UnauthorizedException(UNAUTHENTICATED);
    if (!(await this.identity.hasRole(user.id, 'admin'))) {
      throw new ForbiddenException(ROLE_REFUSALS.administrator);
    }
    return user;
  }

  @Get()
  async list(@Req() request: FastifyRequest): Promise<NewsSourcesResponse> {
    await this.administrator(request);
    return { sources: await this.store.list() };
  }

  @Post('preview')
  @HttpCode(200)
  async preview(@Body() body: unknown, @Req() request: FastifyRequest): Promise<NewsFeedPreview> {
    await this.administrator(request);
    const feedUrl = text(isRecord(body) ? body.feed_url : undefined);
    const problem = NewsSourcesAdminController.urlProblem(feedUrl);
    if (problem !== null) invalid({ feed_url: problem });
    return probeFeed(this.transport, feedUrl);
  }

  @Post()
  async add(
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<NewsSourceWriteResponse> {
    const actor = await this.administrator(request);
    const raw = isRecord(body) ? body : {};
    const fields: Record<string, string> = {};
    const values = NewsSourcesAdminController.fields(raw, fields, true) as NewsSourceFields;
    const reason = NewsSourcesAdminController.reason(raw, fields);
    if (Object.keys(fields).length > 0) invalid(fields);
    if (await this.store.feedTaken(values.feed_url, null)) {
      throw new ConflictException({
        error: 'conflict',
        message: 'A carried source already reads this feed.',
      } satisfies ApiError);
    }
    const preview = await this.checked(values.feed_url, values.kind);
    const { source, auditId } = await this.store.add(actor.id, values, reason);
    return { source, preview, audit_id: auditId };
  }

  @Patch(':id')
  async edit(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<NewsSourceWriteResponse> {
    const actor = await this.administrator(request);
    if (!UUID.test(id)) throw new NotFoundException(NO_SOURCE);
    const sourceId = id.toLowerCase();
    const raw = isRecord(body) ? body : {};
    const fields: Record<string, string> = {};
    const changes = NewsSourcesAdminController.fields(raw, fields, false);
    const reason = NewsSourcesAdminController.reason(raw, fields);
    if (Object.keys(fields).length > 0) invalid(fields);
    const current = await this.store.get(sourceId);
    if (current === null) throw new NotFoundException(NO_SOURCE);
    if (current.kind === 'licensed') {
      invalid({ kind: 'A licensed source is not edited from the console.' });
    }
    const feedUrl = changes.feed_url ?? current.feed_url ?? '';
    const kind = changes.kind ?? (current.kind as NewsSourceKind);
    let preview: NewsFeedPreview | null = null;
    // A new address, or a new kind for the same one, is checked as on adding.
    if (feedUrl !== current.feed_url || kind !== current.kind) {
      if (await this.store.feedTaken(feedUrl, sourceId)) {
        throw new ConflictException({
          error: 'conflict',
          message: 'A carried source already reads this feed.',
        } satisfies ApiError);
      }
      preview = await this.checked(feedUrl, kind);
    }
    const outcome = await this.store.edit(actor.id, sourceId, changes, reason);
    if (outcome.kind === 'no_source') throw new NotFoundException(NO_SOURCE);
    if (outcome.kind === 'dropped') {
      throw new ConflictException({
        error: 'conflict',
        message: 'This source was dropped; a dropped source is not edited.',
      } satisfies ApiError);
    }
    if (outcome.kind === 'unchanged') invalid({ reason: 'Nothing would change.' });
    return { source: outcome.source, preview, audit_id: outcome.auditId };
  }

  @Post(':id/drop')
  async drop(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: FastifyRequest,
  ): Promise<NewsSourceWriteResponse> {
    const actor = await this.administrator(request);
    const raw = isRecord(body) ? body : {};
    const fields: Record<string, string> = {};
    const reason = NewsSourcesAdminController.reason(raw, fields);
    if (Object.keys(fields).length > 0) invalid(fields);
    if (!UUID.test(id)) throw new NotFoundException(NO_SOURCE);
    const outcome = await this.store.drop(actor.id, id.toLowerCase(), reason);
    if (outcome.kind === 'no_source') throw new NotFoundException(NO_SOURCE);
    if (outcome.kind === 'already') {
      throw new ConflictException({
        error: 'conflict',
        message: 'This source is already dropped.',
      } satisfies ApiError);
    }
    return { source: outcome.source, preview: null, audit_id: outcome.auditId };
  }

  /** The feed read once after its robots.txt; a refusal says which check failed. */
  private async checked(feedUrl: string, kind: NewsSourceKind): Promise<NewsFeedPreview> {
    const preview = await probeFeed(this.transport, feedUrl);
    const refusal = previewRefusal(preview, kind);
    if (refusal !== null) invalid({ feed_url: refusal });
    return preview;
  }

  private static urlProblem(url: string): string | null {
    if (url === '') return 'Required.';
    if (url.length > MAX_URL) return `At most ${MAX_URL} characters.`;
    const problem = feedUrlProblem(url);
    return problem === null ? null : `The address ${problem}.`;
  }

  private static reason(raw: Record<string, unknown>, fields: Record<string, string>): string {
    const reason = text(raw.reason);
    if (reason === '') fields.reason = 'Say why. Every change to a news source records its reason.';
    else if (reason.length > MAX_REASON) fields.reason = `At most ${MAX_REASON} characters.`;
    return reason;
  }

  /**
   * The source's fields from a body. On adding, every field is required; on
   * editing, only the fields present are read, and each is held to the same
   * rules. Rights are a free feed's (D-061): the headline, or the headline and
   * the publisher's summary -- never the full text.
   */
  private static fields(
    raw: Record<string, unknown>,
    fields: Record<string, string>,
    required: boolean,
  ): Partial<NewsSourceFields> {
    const out: Partial<NewsSourceFields> = {};
    const present = (key: string) => required || raw[key] !== undefined;
    if (present('name')) {
      const name = text(raw.name);
      if (name === '') fields.name = 'Required.';
      else if (name.length > MAX_NAME) fields.name = `At most ${MAX_NAME} characters.`;
      else out.name = name;
    }
    if (present('homepage_url')) {
      const url = text(raw.homepage_url);
      const problem = NewsSourcesAdminController.urlProblem(url);
      if (problem !== null) fields.homepage_url = problem;
      else out.homepage_url = url;
    }
    if (present('feed_url')) {
      const url = text(raw.feed_url);
      const problem = NewsSourcesAdminController.urlProblem(url);
      if (problem !== null) fields.feed_url = problem;
      else out.feed_url = url;
    }
    if (present('kind')) {
      const kind = text(raw.kind);
      if (!(NEWS_SOURCE_KINDS as readonly string[]).includes(kind)) {
        fields.kind = `Must be one of ${NEWS_SOURCE_KINDS.join(', ')}.`;
      } else out.kind = kind as NewsSourceKind;
    }
    if (present('rights')) {
      const rights = text(raw.rights);
      if (!(NEWS_SOURCE_RIGHTS as readonly string[]).includes(rights)) {
        fields.rights = `Must be one of ${NEWS_SOURCE_RIGHTS.join(', ')} (D-061).`;
      } else out.rights = rights as NewsSourceRights;
    }
    if (present('language')) {
      const language = text(raw.language);
      if (!LANGUAGE.test(language))
        fields.language = 'Must be a language tag, such as en or pt-BR.';
      else out.language = language;
    }
    return out;
  }
}
