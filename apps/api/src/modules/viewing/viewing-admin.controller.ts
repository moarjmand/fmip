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
  Put,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ApiError,
  AuthUser,
  Broadcaster,
  BroadcasterKind,
  BroadcasterRequest,
  BroadcasterResponse,
  BroadcastersResponse,
  HighlightRequest,
  ViewingAccess,
  ViewingCoverageRequest,
  ViewingCoverageResponse,
  ViewingCoverageState,
  ViewingModule,
  ViewingOptionRequest,
  ViewingOptionResponse,
  ViewingRemovalRequest,
} from '@fmip/contracts';
import {
  BROADCASTER_KINDS,
  TERRITORY_CODE,
  VIEWING_ACCESS,
  VIEWING_COVERAGE_STATES,
  VIEWING_MODULES,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { PostgresViewingAdminStore } from './internal/viewing-admin-store';
import { ViewingService } from './viewing.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HTTP_URL = /^https?:\/\/\S+$/;
const MAX_TEXT = 2000;
const UNAUTHENTICATED: ApiError = { error: 'unauthenticated', message: 'Sign in to continue.' };
const NOT_AN_EDITOR: ApiError = {
  error: 'validation',
  message: 'This needs the editor or administrator role.',
};
const NO_FIXTURE: ApiError = { error: 'not_found', message: 'No such fixture.' };
const NO_SEASON: ApiError = { error: 'not_found', message: 'No such season.' };
const NO_BROADCASTER: ApiError = { error: 'not_found', message: 'No such broadcaster.' };
const NO_TERRITORY: ApiError = {
  error: 'validation',
  message: 'That is not a territory. Codes are ISO 3166-1 alpha-2, such as GB or IR.',
};
const NOT_COVERED: ApiError = {
  error: 'validation',
  message:
    "Declare the desk's coverage for this season in this territory first, so an empty listing can mean something.",
};

/**
 * The editorial desk (T-313, D-069): where viewing data comes from until a
 * licence says otherwise. Editors and administrators declare coverage per
 * season and territory, keep the broadcaster list, and enter listings and
 * official highlight pages per match and territory. Every write is audited
 * (rule 10) and every removal needs a reason. Nothing here takes a player or
 * a thumbnail: the desk's source grants a link, and the schema (`PL017`)
 * would refuse more even if this file were rewritten to offer it.
 */
@Controller('admin')
export class ViewingAdminController {
  constructor(
    private readonly store: PostgresViewingAdminStore,
    private readonly viewing: ViewingService,
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

  private static refuse(message: string): never {
    throw new BadRequestException({ error: 'validation', message } satisfies ApiError);
  }

  private static text(given: unknown, message: string): string {
    const text = typeof given === 'string' ? given.trim() : '';
    if (text === '') ViewingAdminController.refuse(message);
    return text.slice(0, MAX_TEXT);
  }

  private static url(given: unknown, message: string): string {
    const url = typeof given === 'string' ? given.trim() : '';
    if (!HTTP_URL.test(url) || url.length > MAX_TEXT) ViewingAdminController.refuse(message);
    return url;
  }

  private static territory(given: unknown): string {
    const code = typeof given === 'string' ? given.trim().toUpperCase() : '';
    if (!TERRITORY_CODE.test(code)) throw new BadRequestException(NO_TERRITORY);
    return code;
  }

  private static oneOf<T extends string>(given: unknown, allowed: readonly T[], what: string): T {
    if (typeof given !== 'string' || !(allowed as readonly string[]).includes(given)) {
      ViewingAdminController.refuse(`${what} must be one of ${allowed.join(', ')}.`);
    }
    return given as T;
  }

  private static uuid(given: unknown, error: ApiError): string {
    if (typeof given !== 'string' || !UUID.test(given)) throw new NotFoundException(error);
    return given;
  }

  @Get('viewing/broadcasters')
  async broadcasters(@Req() request: FastifyRequest): Promise<BroadcastersResponse> {
    await this.editor(request);
    return { broadcasters: await this.store.broadcasters() };
  }

  @Post('viewing/broadcasters')
  @HttpCode(201)
  async createBroadcaster(
    @Body() body: BroadcasterRequest,
    @Req() request: FastifyRequest,
  ): Promise<BroadcasterResponse> {
    const user = await this.editor(request);
    const name = ViewingAdminController.text(body?.name, 'A broadcaster needs a name.');
    const kind = ViewingAdminController.oneOf<BroadcasterKind>(
      body?.kind,
      BROADCASTER_KINDS,
      'kind',
    );
    const given = body?.homepage_url;
    const homepage =
      given === null || given === undefined || given === ''
        ? null
        : ViewingAdminController.url(given, 'The homepage must be an http(s) address.');
    const broadcaster: Broadcaster = await this.store.createBroadcaster(user.id, {
      name,
      homepage_url: homepage,
      kind,
    });
    return { broadcaster };
  }

  @Get('viewing/coverage')
  async coverage(
    @Req() request: FastifyRequest,
    @Query('season') season?: string,
  ): Promise<ViewingCoverageResponse> {
    await this.editor(request);
    const seasonId = season === undefined || season === '' ? null : season;
    if (seasonId !== null && !UUID.test(seasonId)) return { coverage: [] };
    const rows = await this.store.coverage(seasonId);
    return {
      coverage: rows.map((row) => ({
        season_id: row.season_id,
        territory: row.territory,
        module: row.module,
        state: row.state,
        source:
          row.source_id === null || row.source_name === null || row.source_rights === null
            ? null
            : { id: row.source_id, name: row.source_name, rights: row.source_rights },
        note: row.note,
        updated_at: row.updated_at.toISOString(),
      })),
    };
  }

  @Put('viewing/coverage')
  @HttpCode(204)
  async declareCoverage(
    @Body() body: ViewingCoverageRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.editor(request);
    const seasonId = ViewingAdminController.uuid(body?.season_id, NO_SEASON);
    const territory = ViewingAdminController.territory(body?.territory);
    const module = ViewingAdminController.oneOf<ViewingModule>(
      body?.module,
      VIEWING_MODULES,
      'module',
    );
    const state = ViewingAdminController.oneOf<ViewingCoverageState>(
      body?.state,
      VIEWING_COVERAGE_STATES,
      'state',
    );
    const note = ViewingAdminController.text(
      body?.note,
      'Say which schedule the desk is working from. This is recorded.',
    );
    const outcome = await this.store.declareCoverage(user.id, {
      season_id: seasonId,
      territory,
      module,
      state,
      note,
    });
    if (outcome === 'no_season') throw new NotFoundException(NO_SEASON);
    if (outcome === 'no_territory') throw new BadRequestException(NO_TERRITORY);
    if (outcome === 'desk_dropped') {
      ViewingAdminController.refuse(
        'The editorial desk was dropped as a source; nothing can be declared under it.',
      );
    }
  }

  @Post('fixtures/:id/viewing-options')
  @HttpCode(201)
  async listOption(
    @Param('id') fixtureId: string,
    @Body() body: ViewingOptionRequest,
    @Req() request: FastifyRequest,
  ): Promise<ViewingOptionResponse> {
    const user = await this.editor(request);
    if (!UUID.test(fixtureId)) throw new NotFoundException(NO_FIXTURE);
    const territory = ViewingAdminController.territory(body?.territory);
    const broadcasterId = ViewingAdminController.uuid(body?.broadcaster_id, NO_BROADCASTER);
    const access = ViewingAdminController.oneOf<ViewingAccess>(
      body?.access,
      VIEWING_ACCESS,
      'access',
    );
    const url = ViewingAdminController.url(
      body?.url,
      'The destination must be the official http(s) address.',
    );
    const result = await this.store.listOption(user.id, fixtureId, {
      territory,
      broadcaster_id: broadcasterId,
      access,
      url,
    });
    switch (result.outcome) {
      case 'no_fixture':
        throw new NotFoundException(NO_FIXTURE);
      case 'no_broadcaster':
        throw new NotFoundException(NO_BROADCASTER);
      case 'no_territory':
        throw new BadRequestException(NO_TERRITORY);
      case 'not_covered':
        throw new BadRequestException(NOT_COVERED);
      case 'already':
        ViewingAdminController.refuse(
          'This service is already listed for this match in this territory. Remove that listing first.',
        );
    }
    // Read back through the same shape the public surfaces get, so the editor sees what a viewer will.
    const [match] = await this.viewing.forFixtures([fixtureId], {
      state: 'chosen',
      territory: { code: territory, name: territory },
    });
    const option = match?.options.data?.find((o) => o.id === result.id);
    if (option === undefined) throw new NotFoundException(NO_FIXTURE);
    return { option };
  }

  @Post('fixtures/:id/viewing-options/:optionId/remove')
  @HttpCode(204)
  async removeOption(
    @Param('id') fixtureId: string,
    @Param('optionId') optionId: string,
    @Body() body: ViewingRemovalRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.editor(request);
    const reason = ViewingAdminController.text(
      body?.reason,
      'Say why. This is recorded against the match.',
    );
    if (
      !UUID.test(fixtureId) ||
      !UUID.test(optionId) ||
      !(await this.store.removeOption(user.id, fixtureId, optionId, reason))
    ) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'No such listing on this match.',
      } satisfies ApiError);
    }
  }

  @Put('fixtures/:id/highlight')
  @HttpCode(204)
  async setHighlight(
    @Param('id') fixtureId: string,
    @Body() body: HighlightRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.editor(request);
    if (!UUID.test(fixtureId)) throw new NotFoundException(NO_FIXTURE);
    const territory = ViewingAdminController.territory(body?.territory);
    const url = ViewingAdminController.url(
      body?.url,
      'The highlight must be the official http(s) page. The desk holds no rights to a player.',
    );
    const outcome = await this.store.setHighlight(user.id, fixtureId, { territory, url });
    if (outcome === 'no_fixture') throw new NotFoundException(NO_FIXTURE);
    if (outcome === 'no_territory') throw new BadRequestException(NO_TERRITORY);
    if (outcome === 'not_covered') throw new BadRequestException(NOT_COVERED);
  }

  @Post('fixtures/:id/highlight/:territory/remove')
  @HttpCode(204)
  async removeHighlight(
    @Param('id') fixtureId: string,
    @Param('territory') given: string,
    @Body() body: ViewingRemovalRequest,
    @Req() request: FastifyRequest,
  ): Promise<void> {
    const user = await this.editor(request);
    const reason = ViewingAdminController.text(
      body?.reason,
      'Say why. This is recorded against the match.',
    );
    const territory = ViewingAdminController.territory(given);
    if (
      !UUID.test(fixtureId) ||
      !(await this.store.removeHighlight(user.id, fixtureId, territory, reason))
    ) {
      throw new NotFoundException({
        error: 'not_found',
        message: 'No highlight for this match in this territory.',
      } satisfies ApiError);
    }
  }
}
