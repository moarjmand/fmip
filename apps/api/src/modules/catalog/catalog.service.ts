import { Inject, Injectable } from '@nestjs/common';
import type { CountrySummary } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';

/**
 * The catalog boundary's read side. Today: the country list for registration.
 * Competitions, teams and players follow with E3, each as a query here and a
 * shape in `@fmip/contracts`.
 */
@Injectable()
export class CatalogService {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async countries(): Promise<CountrySummary[]> {
    const { rows } = await this.pool.query<CountrySummary>(
      `SELECT id, code, iso2, name FROM country ORDER BY name`,
    );
    return rows;
  }
}
