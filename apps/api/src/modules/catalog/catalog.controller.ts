import { Controller, Get } from '@nestjs/common';
import type { CompetitionsResponse, CountriesResponse, TeamsResponse } from '@fmip/contracts';
import { CatalogService } from './catalog.service';

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
}
