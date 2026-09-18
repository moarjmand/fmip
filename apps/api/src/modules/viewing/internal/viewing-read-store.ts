import { Inject, Injectable } from '@nestjs/common';
import type { CoverageState, Territory, ViewingModule, ViewingRights } from '@fmip/contracts';
import { Pool } from 'pg';
import { PG_POOL } from '../../../database/database.module';

export interface FixtureSeasonRow {
  id: string;
  season_id: string;
}

export interface CoverageRow {
  season_id: string;
  territory: string;
  module: ViewingModule;
  state: CoverageState;
  source_id: string | null;
  source_name: string | null;
  source_rights: ViewingRights | null;
  note: string | null;
  updated_at: Date;
}

export interface OptionRow {
  id: string;
  fixture_id: string;
  territory: string;
  access: 'free' | 'registration' | 'subscription' | 'pay_per_view';
  url: string;
  fetched_at: Date;
  broadcaster_id: string;
  broadcaster_name: string;
  broadcaster_homepage_url: string | null;
  broadcaster_kind: 'tv' | 'streaming' | 'radio';
  source_id: string;
  source_name: string;
  source_rights: ViewingRights;
}

export interface HighlightRow {
  id: string;
  fixture_id: string;
  territory: string;
  kind: 'embed' | 'official_page';
  url: string;
  embed_url: string | null;
  thumbnail_url: string | null;
  fetched_at: Date;
  source_id: string;
  source_name: string;
  source_rights: ViewingRights;
}

/**
 * The viewing rows for a set of matches in one territory (T-313). Reads only;
 * every row carries its source and what the source grants, so the service
 * that shapes the answer never has to look a rights question up twice.
 */
@Injectable()
export class PostgresViewingReadStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async territory(code: string): Promise<Territory | null> {
    const { rows } = await this.pool.query<Territory>(
      `SELECT code, name FROM territory WHERE code = $1`,
      [code],
    );
    return rows[0] ?? null;
  }

  async fixtures(ids: string[]): Promise<FixtureSeasonRow[]> {
    const { rows } = await this.pool.query<FixtureSeasonRow>(
      `SELECT id, season_id FROM fixture WHERE id = ANY($1::uuid[])`,
      [ids],
    );
    return rows;
  }

  async coverage(seasonIds: string[], territory: string): Promise<CoverageRow[]> {
    const { rows } = await this.pool.query<CoverageRow>(
      `SELECT c.season_id, c.territory, c.module, c.state, c.source_id,
              s.name AS source_name, s.rights AS source_rights, c.note, c.updated_at
         FROM viewing_coverage c
         LEFT JOIN viewing_source s ON s.id = c.source_id
        WHERE c.season_id = ANY($1::uuid[]) AND c.territory = $2`,
      [seasonIds, territory],
    );
    return rows;
  }

  async options(fixtureIds: string[], territory: string): Promise<OptionRow[]> {
    const { rows } = await this.pool.query<OptionRow>(
      `SELECT o.id, o.fixture_id, o.territory, o.access, o.url, o.fetched_at,
              b.id AS broadcaster_id, b.name AS broadcaster_name,
              b.homepage_url AS broadcaster_homepage_url, b.kind AS broadcaster_kind,
              s.id AS source_id, s.name AS source_name, s.rights AS source_rights
         FROM viewing_option o
         JOIN broadcaster b ON b.id = o.broadcaster_id
         JOIN viewing_source s ON s.id = o.source_id
        WHERE o.fixture_id = ANY($1::uuid[]) AND o.territory = $2
        ORDER BY b.name, b.id`,
      [fixtureIds, territory],
    );
    return rows;
  }

  async highlights(fixtureIds: string[], territory: string): Promise<HighlightRow[]> {
    const { rows } = await this.pool.query<HighlightRow>(
      `SELECT h.id, h.fixture_id, h.territory, h.kind, h.url, h.embed_url, h.thumbnail_url,
              h.fetched_at, s.id AS source_id, s.name AS source_name, s.rights AS source_rights
         FROM highlight h
         JOIN viewing_source s ON s.id = h.source_id
        WHERE h.fixture_id = ANY($1::uuid[]) AND h.territory = $2`,
      [fixtureIds, territory],
    );
    return rows;
  }
}
