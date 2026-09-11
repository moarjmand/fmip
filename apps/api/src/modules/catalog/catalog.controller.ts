import { Controller, Get, NotFoundException, Param, Query } from '@nestjs/common';
import type {
  ApiError,
  CompetitionPage,
  CompetitionsResponse,
  CountriesResponse,
  PlayerPage,
  TeamPage,
  TeamsResponse,
} from '@fmip/contracts';
import { CatalogService } from './catalog.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_COMPETITION: ApiError = { error: 'not_found', message: 'No such competition.' };
const NO_TEAM: ApiError = { error: 'not_found', message: 'No such team.' };
const NO_PLAYER: ApiError = { error: 'not_found', message: 'No such player.' };
const NO_SEASON: ApiError = {
  error: 'not_found',
  message: 'No such season of this competition.',
};

/** Fastify hands a repeated parameter over as an array; the first one counts. */
function first(value: unknown): string | undefined {
  const v = Array.isArray(value) ? value[0] : value;
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : undefined;
}

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('countries')
  async countries(): Promise<CountriesResponse> {
    return { countries: await this.catalog.countries() };
  }

  @Get('teams')
  async teams(): Promise<TeamsResponse> {
    return { teams: await this.catalog.teams() };
  }

  @Get('competitions')
  async competitions(): Promise<CompetitionsResponse> {
    return { competitions: await this.catalog.competitions() };
  }

  /** The player page (blueprint 5.3, T-037). Public. */
  @Get('players/:id')
  async player(@Param('id') id: string): Promise<PlayerPage> {
    if (!UUID.test(id)) throw new NotFoundException(NO_PLAYER);
    const outcome = await this.catalog.player(id.toLowerCase());
    if (outcome.kind === 'unknown_player') throw new NotFoundException(NO_PLAYER);
    return outcome.page;
  }

  /** The team page (blueprint 5.2, T-036). Public. */
  @Get('teams/:id')
  async team(@Param('id') id: string): Promise<TeamPage> {
    if (!UUID.test(id)) throw new NotFoundException(NO_TEAM);
    const outcome = await this.catalog.team(id.toLowerCase());
    if (outcome.kind === 'unknown_team') throw new NotFoundException(NO_TEAM);
    return outcome.page;
  }

  /** The competition page (blueprint 5.1, T-035). Public. `?season=` selects a season. */
  @Get('competitions/:id')
  async competition(
    @Param('id') id: string,
    @Query('season') season: unknown,
  ): Promise<CompetitionPage> {
    if (!UUID.test(id)) throw new NotFoundException(NO_COMPETITION);
    const wanted = first(season);
    if (wanted !== undefined && !UUID.test(wanted)) throw new NotFoundException(NO_SEASON);
    const outcome = await this.catalog.competition(id.toLowerCase(), wanted?.toLowerCase() ?? null);
    switch (outcome.kind) {
      case 'ok':
        return outcome.page;
      case 'unknown_competition':
        throw new NotFoundException(NO_COMPETITION);
      case 'unknown_season':
      case 'no_seasons':
        throw new NotFoundException(NO_SEASON);
    }
  }
}
