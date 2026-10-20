import { Inject, Injectable } from '@nestjs/common';
import type {
  CoverageState,
  FixtureStatus,
  Territory,
  ViewingModule,
  ViewingRights,
} from '@fmip/contracts';
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
  /** The default that created it; null when entered by hand (T-1360). */
  default_id: string | null;
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

/** A licensed feed's clip for a match (T-1366), with its territory rule: evaluated by the service, never here. */
export interface FeedHighlightRow {
  id: string;
  fixture_id: string;
  url: string;
  publisher: string | null;
  allowed_territories: string[];
  blocked_territories: string[];
  fetched_at: Date;
  source_id: string;
  source_name: string;
  source_rights: ViewingRights;
}

/**
 * One clip in the feed's index (T-1434): enough to judge its territory rule,
 * file it under its competition and order it, nothing to show yet.
 */
export interface FeedIndexRow {
  id: string;
  competition_id: string;
  competition_name: string;
  competition_short_name: string | null;
  allowed_territories: string[];
  blocked_territories: string[];
  kickoff_at: Date;
}

/** A listed clip with its match, for the page of the Highlights list (T-1434). */
export interface FeedItemRow {
  id: string;
  url: string;
  publisher: string | null;
  fetched_at: Date;
  source_id: string;
  source_name: string;
  source_rights: ViewingRights;
  fixture_id: string;
  kickoff_at: Date;
  status: FixtureStatus;
  competition_id: string;
  competition_name: string;
  competition_short_name: string | null;
  home_id: string;
  home_name: string;
  home_short_name: string | null;
  away_id: string;
  away_name: string;
  away_short_name: string | null;
  scores: Record<string, { home: number; away: number }> | null;
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
              s.id AS source_id, s.name AS source_name, s.rights AS source_rights,
              o.default_id
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

  /** The feed's clips for these matches, not withdrawn, from a source not dropped; any territory. */
  async feedHighlights(fixtureIds: string[]): Promise<FeedHighlightRow[]> {
    const { rows } = await this.pool.query<FeedHighlightRow>(
      `SELECT h.id, h.fixture_id, h.url, h.publisher, h.allowed_territories,
              h.blocked_territories, h.fetched_at,
              s.id AS source_id, s.name AS source_name, s.rights AS source_rights
         FROM highlight_feed h
         JOIN viewing_source s ON s.id = h.source_id
        WHERE h.fixture_id = ANY($1::uuid[])
          AND h.withdrawn_at IS NULL AND s.dropped_at IS NULL`,
      [fixtureIds],
    );
    return rows;
  }

  /**
   * Every clip the feed holds that a reader may be offered (T-1434): not
   * withdrawn, from a source not dropped, on an active competition; newest
   * match first. The territory rule is the service's (`offeredIn`), so the
   * one copy of it decides here too.
   */
  async feedIndex(): Promise<FeedIndexRow[]> {
    const { rows } = await this.pool.query<FeedIndexRow>(
      `SELECT h.id, c.id AS competition_id, c.name AS competition_name,
              c.short_name AS competition_short_name,
              h.allowed_territories, h.blocked_territories, f.kickoff_at
         FROM highlight_feed h
         JOIN viewing_source s ON s.id = h.source_id
         JOIN fixture f ON f.id = h.fixture_id
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
        WHERE h.withdrawn_at IS NULL AND s.dropped_at IS NULL AND c.is_active
        ORDER BY f.kickoff_at DESC, h.fetched_at DESC, h.id`,
    );
    return rows;
  }

  /** These clips with their matches, in the order asked. */
  async feedItems(ids: string[]): Promise<FeedItemRow[]> {
    if (ids.length === 0) return [];
    const { rows } = await this.pool.query<FeedItemRow>(
      `SELECT h.id, h.url, h.publisher, h.fetched_at,
              s.id AS source_id, s.name AS source_name, s.rights AS source_rights,
              f.id AS fixture_id, f.kickoff_at, f.status,
              c.id AS competition_id, c.name AS competition_name,
              c.short_name AS competition_short_name,
              th.id AS home_id, th.name AS home_name, th.short_name AS home_short_name,
              ta.id AS away_id, ta.name AS away_name, ta.short_name AS away_short_name,
              (SELECT jsonb_object_agg(sc.kind, jsonb_build_object('home', sc.home, 'away', sc.away))
                 FROM fixture_score sc WHERE sc.fixture_id = f.id) AS scores
         FROM highlight_feed h
         JOIN viewing_source s ON s.id = h.source_id
         JOIN fixture f ON f.id = h.fixture_id
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         JOIN fixture_participant hp ON hp.fixture_id = f.id AND hp.side = 'home'
         JOIN team th ON th.id = hp.team_id
         JOIN fixture_participant ap ON ap.fixture_id = f.id AND ap.side = 'away'
         JOIN team ta ON ta.id = ap.team_id
        WHERE h.id = ANY($1::uuid[])
        ORDER BY array_position($1::uuid[], h.id)`,
      [ids],
    );
    return rows;
  }
}
