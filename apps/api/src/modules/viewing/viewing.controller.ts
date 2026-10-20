import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
  Req,
} from '@nestjs/common';
import type {
  ApiError,
  HighlightsResponse,
  MatchViewing,
  ViewingBatchResponse,
  ViewingTerritory,
} from '@fmip/contracts';
import type { FastifyRequest } from 'fastify';
import { IdentityService, SESSION_COOKIE, parseCookies } from '../identity/identity.service';
import { ViewingService } from './viewing.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_BATCH = 100;
const NO_FIXTURE: ApiError = { error: 'not_found', message: 'No such fixture.' };
const NOT_A_TERRITORY: ApiError = {
  error: 'validation',
  message: 'That is not a territory. Codes are ISO 3166-1 alpha-2, such as GB or IR.',
};

/** The most pages `GET /highlights` answers: a ceiling, not a promise that many exist. */
const MAX_PAGE = 500;

/** `?page=` (T-1434): a whole number from 1 to `MAX_PAGE`, absent is 1; anything else is refused. */
export function pageOf(value: unknown): number | null {
  const v = Array.isArray(value) ? value[0] : value;
  if (v === undefined || v === '') return 1;
  if (typeof v !== 'string' || !/^\d{1,3}$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= MAX_PAGE ? n : null;
}

/**
 * Where a match can be watched (blueprint 11, T-313), for anyone: `GET
 * /fixtures/:id/viewing` and `GET /viewing?fixture=…` for several at once.
 * The territory is the viewer's stored choice (T-312), or `?territory=` for
 * a guest or a member looking at another country on purpose; a code that is
 * not a territory is refused, never mapped to a neighbour, and no territory
 * at all is answered as `not_chosen`, which the surface turns into a question.
 */
@Controller()
export class ViewingController {
  constructor(
    private readonly viewing: ViewingService,
    private readonly identity: IdentityService,
  ) {}

  private async territory(
    asked: string | undefined,
    request: FastifyRequest,
  ): Promise<ViewingTerritory> {
    const viewer = await this.identity.authenticate(
      parseCookies(request.headers.cookie)[SESSION_COOKIE],
    );
    const territory = await this.viewing.territory(asked, viewer);
    if (territory === 'unknown') throw new BadRequestException(NOT_A_TERRITORY);
    return territory;
  }

  @Get('fixtures/:id/viewing')
  async one(
    @Param('id') id: string,
    @Query('territory') asked: string | undefined,
    @Req() request: FastifyRequest,
  ): Promise<MatchViewing> {
    if (!UUID.test(id)) throw new NotFoundException(NO_FIXTURE);
    const territory = await this.territory(asked, request);
    const [match] = await this.viewing.forFixtures([id], territory);
    if (match === undefined) throw new NotFoundException(NO_FIXTURE);
    return match;
  }

  @Get('viewing')
  async many(
    @Query('fixture') fixture: string | string[] | undefined,
    @Query('territory') asked: string | undefined,
    @Req() request: FastifyRequest,
  ): Promise<ViewingBatchResponse> {
    const given = (Array.isArray(fixture) ? fixture : fixture === undefined ? [] : [fixture])
      .flatMap((value) => value.split(','))
      .map((value) => value.trim())
      .filter((value) => value !== '');
    const ids = [...new Set(given)];
    if (ids.length === 0 || ids.length > MAX_BATCH || ids.some((id) => !UUID.test(id))) {
      throw new BadRequestException({
        error: 'validation',
        message: `Ask for between 1 and ${MAX_BATCH} fixture ids.`,
      } satisfies ApiError);
    }
    const territory = await this.territory(asked, request);
    return {
      generated_at: new Date().toISOString(),
      territory,
      fixtures: await this.viewing.forFixtures(ids, territory),
    };
  }

  /**
   * The Highlights page (T-1434, D-226): every feed clip offered in the
   * viewer's territory (or, with none, in every territory), newest match
   * first, `?competition=` to filter and `?page=` to page. Public.
   */
  @Get('highlights')
  async highlights(
    @Query('territory') asked: string | undefined,
    @Query('competition') competition: unknown,
    @Query('page') page: unknown,
    @Req() request: FastifyRequest,
  ): Promise<HighlightsResponse> {
    const wanted = Array.isArray(competition) ? competition[0] : competition;
    const id = typeof wanted === 'string' && wanted.trim() !== '' ? wanted.trim() : null;
    const number = pageOf(page);
    if ((id !== null && !UUID.test(id)) || number === null) {
      throw new BadRequestException({
        error: 'validation',
        message: 'The request is not valid.',
        fields: {
          ...(id !== null && !UUID.test(id) ? { competition: 'A competition id.' } : {}),
          ...(number === null ? { page: `A whole number from 1 to ${MAX_PAGE}.` } : {}),
        },
      } satisfies ApiError);
    }
    const territory = await this.territory(asked, request);
    return this.viewing.list(territory, id?.toLowerCase() ?? null, number);
  }
}
