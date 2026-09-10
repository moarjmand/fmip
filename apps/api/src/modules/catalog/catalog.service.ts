import { Inject, Injectable } from '@nestjs/common';
import type { CompetitionSummary, CountrySummary, TeamSummary } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';

/**
 * The catalog boundary's read side: the lists a form or a follow control
 * needs. Full competition, team and player pages follow with E3, each as a
 * query here and a shape in `@fmip/contracts`.
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

  async teams(): Promise<TeamSummary[]> {
    const { rows } = await this.pool.query<TeamSummary>(
      `SELECT id, name, short_name, code, kind, country_id
         FROM team WHERE is_active ORDER BY name`,
    );
    return rows;
  }

  async competitions(): Promise<CompetitionSummary[]> {
    const { rows } = await this.pool.query<CompetitionSummary>(
      `SELECT id, name, short_name, scope, country_id
         FROM competition WHERE is_active ORDER BY name`,
    );
    return rows;
  }
}
