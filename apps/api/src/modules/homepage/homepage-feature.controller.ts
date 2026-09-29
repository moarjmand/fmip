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
  FeaturedMatchesResponse,
  HomepageFeatureClearRequest,
  HomepageFeatureListResponse,
  HomepageFeatureRecord,
  HomepageFeatureRequest,
} from '@fmip/contracts';
import {
  HOMEPAGE_FEATURE_MAX_HOURS,
  HOMEPAGE_FEATURE_MIN_HOURS,
  ROLE_REFUSALS,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PostgresFeatureStore } from './internal/feature-store';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NO_MATCH: ApiError = { error: 'not_found', message: 'No such match.' };
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const MAX_TEXT = 300;

function validation(message: string): BadRequestException {
  return new BadRequestException({ error: 'validation', message } satisfies ApiError);
}

/**
 * Featured matches on the homepage (blueprint 2.3 and 16, T-1161, D-153).
 *
 * `GET /featured-matches` is public: the matches featured now, read at
 * render, so an expired feature is gone on the next one. The console side is
 * editors' and administrators': `POST /admin/fixtures/:id/feature` with the
 * note readers see and a window in hours, `POST .../feature/clear` with a
 * reason, `GET /admin/homepage-features` to list them. Every feature and
 * clear is an `audit_log` row with what was there before (rule 10).
 */
@Controller()
export class HomepageFeatureController {
  constructor(
    private readonly store: PostgresFeatureStore,
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

  private static text(given: unknown, message: string): string {
    const text = typeof given === 'string' ? given.trim() : '';
    if (text === '') throw validation(message);
    return text.slice(0, MAX_TEXT);
  }

  @Get('featured-matches')
  async featured(): Promise<FeaturedMatchesResponse> {
    const rows = await this.store.live();
    return {
      generated_at: new Date().toISOString(),
      features: rows.map((row) => ({
        fixture_id: row.fixture_id,
        note: row.note,
        featured_at: row.featured_at.toISOString(),
        ends_at: row.ends_at.toISOString(),
      })),
    };
  }

  @Get('admin/homepage-features')
  async list(
    @Req() request: FastifyRequest,
    @Query('limit') limit?: string,
  ): Promise<HomepageFeatureListResponse> {
    await this.editor(request);
    const n = Number.parseInt(limit ?? '', 10);
    const capped = Number.isInteger(n) && n > 0 ? Math.min(n, MAX_LIMIT) : DEFAULT_LIMIT;
    const rows = await this.store.list(capped);
    return {
      generated_at: new Date().toISOString(),
      features: rows.map((row): HomepageFeatureRecord => ({
        fixture_id: row.fixture_id,
        home: row.home,
        away: row.away,
        kickoff_at: row.kickoff_at.toISOString(),
        featured_by: row.featured_by,
        note: row.note,
        featured_at: row.featured_at.toISOString(),
        ends_at: row.ends_at.toISOString(),
        cleared_by: row.cleared_by,
        cleared_reason: row.cleared_reason,
        cleared_at: row.cleared_at?.toISOString() ?? null,
        state: row.cleared_at !== null ? 'cleared' : row.live ? 'live' : 'expired',
      })),
    };
  }

  @Post('admin/fixtures/:id/feature')
  @HttpCode(204)
  async feature(
    @Param('id') fixtureId: string,
    @Body() body: HomepageFeatureRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.editor(request);
    const note = HomepageFeatureController.text(
      body?.note,
      'Say why this match is featured. Readers see it on the homepage, and it is recorded.',
    );
    const hours = body?.hours;
    if (
      typeof hours !== 'number' ||
      !Number.isInteger(hours) ||
      hours < HOMEPAGE_FEATURE_MIN_HOURS ||
      hours > HOMEPAGE_FEATURE_MAX_HOURS
    ) {
      throw validation(
        `Say for how many hours, a whole number from ${HOMEPAGE_FEATURE_MIN_HOURS} to ${HOMEPAGE_FEATURE_MAX_HOURS}.`,
      );
    }
    if (!UUID.test(fixtureId)) throw new NotFoundException(NO_MATCH);
    const outcome = await this.store.feature(fixtureId.toLowerCase(), user.id, note, hours);
    if (outcome.kind === 'no_fixture') throw new NotFoundException(NO_MATCH);
    if (outcome.kind === 'not_open') {
      throw validation(
        `Only a match still to be played or in play can be featured; this one is ${outcome.status}.`,
      );
    }
    if (outcome.kind === 'already') {
      throw validation('This match is already featured. Clear it first to change the note.');
    }
  }

  @Post('admin/fixtures/:id/feature/clear')
  @HttpCode(204)
  async clear(
    @Param('id') fixtureId: string,
    @Body() body: HomepageFeatureClearRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.editor(request);
    const reason = HomepageFeatureController.text(
      body?.reason,
      'Say why. This is recorded against the match.',
    );
    if (
      !UUID.test(fixtureId) ||
      !(await this.store.clear(fixtureId.toLowerCase(), user.id, reason))
    ) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'This match is not featured now.',
      } satisfies ApiError);
    }
  }
}
