import {
  BadRequestException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Query,
} from '@nestjs/common';
import type {
  ApiError,
  CompetitionContext,
  CompetitionPage,
  CompetitionsResponse,
  CountriesResponse,
  FollowSuggestionsResponse,
  PlayerPage,
  TeamPage,
  TeamsResponse,
} from '@fmip/contracts';
import { LEADERS_MINUTES_MAX } from '@fmip/contracts';
import { CatalogService } from './catalog.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NO_COMPETITION: ApiError = { error: 'not_found', message: 'No such competition.' };
const NO_TEAM: ApiError = { error: 'not_found', message: 'No such team.' };
const NO_PLAYER: ApiError = { error: 'not_found', message: 'No such player.' };
const NO_FIXTURE: ApiError = { error: 'not_found', message: 'No such fixture.' };
const NO_SEASON: ApiError = {
  error: 'not_found',
  message: 'No such season of this competition.',
};

/** Fastify hands a repeated parameter over as an array; the first one counts. */
/**
 * A locale tag for `?locale=` (T-303): the language the reader wants names
 * in. Anything that is not a plausible BCP 47 tag is `null` rather than 400 --
 * a locale is a preference, not an address, and a page must not fail because
 * its reader's language was spelled oddly.
 */
const LOCALE = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;
function localeOf(value: unknown): string | null {
  const v = first(value);
  return v !== undefined && LOCALE.test(v) ? v : null;
}

/**
 * `?min_minutes=` on the competition page (T-824): a whole number of minutes
 * from 1 to `LEADERS_MINUTES_MAX`; absent or `0` is no floor. Anything else
 * is a 400 naming the field, never a floor quietly guessed.
 */
export function minMinutesOf(value: unknown): { ok: true; value: number | null } | { ok: false } {
  const v = first(value);
  if (v === undefined) return { ok: true, value: null };
  if (!/^\d{1,5}$/.test(v)) return { ok: false };
  const n = Number(v);
  if (n > LEADERS_MINUTES_MAX) return { ok: false };
  return { ok: true, value: n === 0 ? null : n };
}

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

  /**
   * What to follow next, for a member who follows nothing (T-622). Public: it
   * names no member, only teams and how many follow them.
   */
  @Get('follow-suggestions')
  followSuggestions(): Promise<FollowSuggestionsResponse> {
    return this.catalog.followSuggestions();
  }

  /** The player page (blueprint 5.3, T-037). Public. */
  @Get('players/:id')
  async player(@Param('id') id: string, @Query('locale') locale: unknown): Promise<PlayerPage> {
    if (!UUID.test(id)) throw new NotFoundException(NO_PLAYER);
    const outcome = await this.catalog.player(id.toLowerCase(), localeOf(locale));
    if (outcome.kind === 'unknown_player') throw new NotFoundException(NO_PLAYER);
    return outcome.page;
  }

  /** The team page (blueprint 5.2, T-036). Public. */
  @Get('teams/:id')
  async team(@Param('id') id: string, @Query('locale') locale: unknown): Promise<TeamPage> {
    if (!UUID.test(id)) throw new NotFoundException(NO_TEAM);
    const outcome = await this.catalog.team(id.toLowerCase(), localeOf(locale));
    if (outcome.kind === 'unknown_team') throw new NotFoundException(NO_TEAM);
    return outcome.page;
  }

  /**
   * The match centre's competition context (blueprint 4.2, T-840): the
   * table or group before kick-off, or the knockout tie. Public.
   */
  @Get('fixtures/:id/competition-context')
  async competitionContext(@Param('id') id: string): Promise<CompetitionContext> {
    if (!UUID.test(id)) throw new NotFoundException(NO_FIXTURE);
    const context = await this.catalog.competitionContext(id.toLowerCase());
    if (context === null) throw new NotFoundException(NO_FIXTURE);
    return context;
  }

  /** The competition page (blueprint 5.1, T-035). Public. `?season=` selects a season. */
  @Get('competitions/:id')
  async competition(
    @Param('id') id: string,
    @Query('season') season: unknown,
    @Query('locale') locale: unknown,
    @Query('min_minutes') minMinutes: unknown,
  ): Promise<CompetitionPage> {
    if (!UUID.test(id)) throw new NotFoundException(NO_COMPETITION);
    const wanted = first(season);
    if (wanted !== undefined && !UUID.test(wanted)) throw new NotFoundException(NO_SEASON);
    const floor = minMinutesOf(minMinutes);
    if (!floor.ok) {
      throw new BadRequestException({
        error: 'validation',
        message: 'The request is not valid.',
        fields: { min_minutes: `A whole number of minutes from 0 to ${LEADERS_MINUTES_MAX}.` },
      } satisfies ApiError);
    }
    const outcome = await this.catalog.competition(
      id.toLowerCase(),
      wanted?.toLowerCase() ?? null,
      localeOf(locale),
      floor.value,
    );
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
