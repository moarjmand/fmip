import { Controller, Get } from '@nestjs/common';
import type { CountriesResponse } from '@fmip/contracts';
import { CatalogService } from './catalog.service';

@Controller()
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get('countries')
  async countries(): Promise<CountriesResponse> {
    return { countries: await this.catalog.countries() };
  }
}
