import { Inject, Injectable } from '@nestjs/common';
import type {
  BroadcasterKind,
  CoverageState,
  ViewingAccess,
  ViewingCoverageState,
  ViewingModule,
  ViewingRights,
} from '@fmip/contracts';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';

/** The editorial desk's row, fixed by the T-313 migration and named by id (rule 1). */
export const EDITORIAL_SOURCE = '00000000-0000-4000-8000-000000000901';

export interface BroadcasterRow {
  id: string;
  name: string;
  homepage_url: string | null;
  kind: BroadcasterKind;
}

export interface CoverageRecordRow {
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

export type CoverageOutcome = 'declared' | 'no_season' | 'no_territory' | 'desk_dropped';

export type ListingOutcome =
  | { outcome: 'listed'; id: string }
  | { outcome: 'no_fixture' | 'no_broadcaster' | 'no_territory' | 'not_covered' | 'already' };

export type HighlightOutcome = 'set' | 'no_fixture' | 'no_territory' | 'not_covered';

interface Codeful {
  code?: string;
  constraint?: string;
}

interface AuditEntry {
  actorId: string;
  action: string;
  targetType: 'season' | 'broadcaster' | 'fixture';
  targetId: string;
  reason: string;
  previous: Record<string, unknown> | null;
  next: Record<string, unknown>;
}

/**
 * The editorial desk's writes (T-313, D-069). Every listing and highlight is
 * entered under the desk's source, which grants a link and nothing more, so
 * the schema's `PL017` would refuse a player or a thumbnail even if a caller
 * offered one -- and no method here takes one. Coverage is declared before a
 * row is entered: a listing in a territory nobody declared would be a fact
 * nobody stood behind. Each write is one transaction with its audit row
 * (rule 10): the editor, the reason, and what was there before.
 */
@Injectable()
export class PostgresViewingAdminStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async broadcasters(): Promise<BroadcasterRow[]> {
    const { rows } = await this.pool.query<BroadcasterRow>(
      `SELECT id, name, homepage_url, kind FROM broadcaster ORDER BY name, id`,
    );
    return rows;
  }

  async createBroadcaster(
    actorId: string,
    input: { name: string; homepage_url: string | null; kind: BroadcasterKind },
  ): Promise<BroadcasterRow> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<BroadcasterRow>(
        `INSERT INTO broadcaster (name, homepage_url, kind) VALUES ($1, $2, $3)
         RETURNING id, name, homepage_url, kind`,
        [input.name, input.homepage_url, input.kind],
      );
      const row = rows[0]!;
      await record(client, {
        actorId,
        action: 'broadcaster.create',
        targetType: 'broadcaster',
        targetId: row.id,
        reason: 'entered by the editorial desk',
        previous: null,
        next: { name: row.name, homepage_url: row.homepage_url, kind: row.kind },
      });
      return row;
    });
  }

  async coverage(seasonId: string | null): Promise<CoverageRecordRow[]> {
    const { rows } = await this.pool.query<CoverageRecordRow>(
      `SELECT c.season_id, c.territory, c.module, c.state, c.source_id,
              s.name AS source_name, s.rights AS source_rights, c.note, c.updated_at
         FROM viewing_coverage c
         LEFT JOIN viewing_source s ON s.id = c.source_id
        WHERE $1::uuid IS NULL OR c.season_id = $1
        ORDER BY c.season_id, c.territory, c.module`,
      [seasonId],
    );
    return rows;
  }

  /** Declares (or re-declares) coverage for a season in a territory; `not_supplied` is a declaration too, and carries no source. */
  async declareCoverage(
    actorId: string,
    input: {
      season_id: string;
      territory: string;
      module: ViewingModule;
      state: ViewingCoverageState;
      note: string;
    },
  ): Promise<CoverageOutcome> {
    return this.transaction(async (client) => {
      const desk = await client.query(
        `SELECT 1 FROM viewing_source WHERE id = $1 AND dropped_at IS NULL`,
        [EDITORIAL_SOURCE],
      );
      if ((desk.rowCount ?? 0) === 0) return 'desk_dropped';
      const previous = await client.query<{ state: CoverageState; note: string | null }>(
        `SELECT state, note FROM viewing_coverage
          WHERE season_id = $1 AND territory = $2 AND module = $3 FOR UPDATE`,
        [input.season_id, input.territory, input.module],
      );
      try {
        await client.query(
          `INSERT INTO viewing_coverage (season_id, territory, module, state, source_id, note)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (season_id, territory, module)
           DO UPDATE SET state = EXCLUDED.state, source_id = EXCLUDED.source_id, note = EXCLUDED.note`,
          [
            input.season_id,
            input.territory,
            input.module,
            input.state,
            input.state === 'not_supplied' ? null : EDITORIAL_SOURCE,
            input.note,
          ],
        );
      } catch (error) {
        const failed = error as Codeful;
        if (failed.code === '23503' && failed.constraint === 'viewing_coverage_season_id_fkey') {
          return 'no_season';
        }
        if (failed.code === '23503' && failed.constraint === 'viewing_coverage_territory_fkey') {
          return 'no_territory';
        }
        throw error;
      }
      const last = previous.rows[0];
      await record(client, {
        actorId,
        action: 'viewing.declare',
        targetType: 'season',
        targetId: input.season_id,
        reason: input.note,
        previous: last === undefined ? null : { state: last.state, note: last.note },
        next: { territory: input.territory, module: input.module, state: input.state },
      });
      return 'declared';
    });
  }

  async listOption(
    actorId: string,
    fixtureId: string,
    input: { territory: string; broadcaster_id: string; access: ViewingAccess; url: string },
  ): Promise<ListingOutcome> {
    return this.transaction(async (client) => {
      const covered = await this.covered(client, fixtureId, input.territory, 'viewing');
      if (covered !== 'covered') return { outcome: covered };
      try {
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO viewing_option (fixture_id, territory, broadcaster_id, source_id, access, url)
           VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
          [
            fixtureId,
            input.territory,
            input.broadcaster_id,
            EDITORIAL_SOURCE,
            input.access,
            input.url,
          ],
        );
        const id = rows[0]!.id;
        await record(client, {
          actorId,
          action: 'viewing.list',
          targetType: 'fixture',
          targetId: fixtureId,
          reason: 'entered by the editorial desk',
          previous: null,
          next: { option_id: id, ...input },
        });
        return { outcome: 'listed', id };
      } catch (error) {
        const failed = error as Codeful;
        if (failed.code === '23503' && failed.constraint === 'viewing_option_broadcaster_id_fkey') {
          return { outcome: 'no_broadcaster' };
        }
        if (failed.code === '23505' && failed.constraint === 'viewing_option_one_per_service') {
          return { outcome: 'already' };
        }
        throw error;
      }
    });
  }

  async removeOption(
    actorId: string,
    fixtureId: string,
    optionId: string,
    reason: string,
  ): Promise<boolean> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<{
        territory: string;
        broadcaster_id: string;
        access: ViewingAccess;
        url: string;
      }>(
        `DELETE FROM viewing_option WHERE id = $1 AND fixture_id = $2
         RETURNING territory, broadcaster_id, access, url`,
        [optionId, fixtureId],
      );
      const gone = rows[0];
      if (gone === undefined) return false;
      await record(client, {
        actorId,
        action: 'viewing.unlist',
        targetType: 'fixture',
        targetId: fixtureId,
        reason,
        previous: { option_id: optionId, ...gone },
        next: { option_id: optionId, removed: true },
      });
      return true;
    });
  }

  /** The official highlight page for a territory: set, or replaced. Never a player: the desk grants a link. */
  async setHighlight(
    actorId: string,
    fixtureId: string,
    input: { territory: string; url: string },
  ): Promise<HighlightOutcome> {
    return this.transaction(async (client) => {
      const covered = await this.covered(client, fixtureId, input.territory, 'highlights');
      if (covered !== 'covered') return covered;
      const previous = await client.query<{ id: string; url: string; source_id: string }>(
        `SELECT id, url, source_id FROM highlight WHERE fixture_id = $1 AND territory = $2 FOR UPDATE`,
        [fixtureId, input.territory],
      );
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO highlight (fixture_id, territory, source_id, kind, url, embed_url, thumbnail_url)
         VALUES ($1, $2, $3, 'official_page', $4, NULL, NULL)
         ON CONFLICT (fixture_id, territory)
         DO UPDATE SET source_id = EXCLUDED.source_id, kind = 'official_page', url = EXCLUDED.url,
                       embed_url = NULL, thumbnail_url = NULL, fetched_at = now()
         RETURNING id`,
        [fixtureId, input.territory, EDITORIAL_SOURCE, input.url],
      );
      const last = previous.rows[0];
      await record(client, {
        actorId,
        action: 'highlight.set',
        targetType: 'fixture',
        targetId: fixtureId,
        reason: 'entered by the editorial desk',
        previous:
          last === undefined
            ? null
            : { highlight_id: last.id, url: last.url, source_id: last.source_id },
        next: { highlight_id: rows[0]!.id, territory: input.territory, url: input.url },
      });
      return 'set';
    });
  }

  async removeHighlight(
    actorId: string,
    fixtureId: string,
    territory: string,
    reason: string,
  ): Promise<boolean> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<{ id: string; url: string }>(
        `DELETE FROM highlight WHERE fixture_id = $1 AND territory = $2 RETURNING id, url`,
        [fixtureId, territory],
      );
      const gone = rows[0];
      if (gone === undefined) return false;
      await record(client, {
        actorId,
        action: 'highlight.remove',
        targetType: 'fixture',
        targetId: fixtureId,
        reason,
        previous: { highlight_id: gone.id, territory, url: gone.url },
        next: { highlight_id: gone.id, removed: true },
      });
      return true;
    });
  }

  /** Whether the desk declared this match's season covered in this territory for the module -- the precondition for entering a row. */
  private async covered(
    client: PoolClient,
    fixtureId: string,
    territory: string,
    module: ViewingModule,
  ): Promise<'covered' | 'no_fixture' | 'no_territory' | 'not_covered'> {
    const fixture = await client.query<{ season_id: string }>(
      `SELECT season_id FROM fixture WHERE id = $1`,
      [fixtureId],
    );
    const season = fixture.rows[0]?.season_id;
    if (season === undefined) return 'no_fixture';
    const known = await client.query(`SELECT 1 FROM territory WHERE code = $1`, [territory]);
    if ((known.rowCount ?? 0) === 0) return 'no_territory';
    const declared = await client.query(
      `SELECT 1 FROM viewing_coverage
        WHERE season_id = $1 AND territory = $2 AND module = $3
          AND state <> 'not_supplied' AND source_id = $4`,
      [season, territory, module, EDITORIAL_SOURCE],
    );
    return (declared.rowCount ?? 0) === 0 ? 'not_covered' : 'covered';
  }

  private async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function record(client: PoolClient, entry: AuditEntry): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::jsonb)`,
    [
      entry.actorId,
      entry.action,
      entry.targetType,
      entry.targetId,
      entry.reason,
      entry.previous === null ? null : JSON.stringify(entry.previous),
      JSON.stringify(entry.next),
    ],
  );
}
