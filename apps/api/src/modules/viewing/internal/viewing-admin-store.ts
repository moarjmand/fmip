import { Inject, Injectable } from '@nestjs/common';
import type {
  BroadcasterKind,
  CoverageState,
  FixtureStatus,
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

/** A standing default as the desk lists it (T-1360). */
export interface DefaultRow {
  id: string;
  competition_id: string;
  competition_name: string;
  territory: string;
  broadcaster_id: string;
  broadcaster_name: string;
  broadcaster_homepage_url: string | null;
  broadcaster_kind: BroadcasterKind;
  access: ViewingAccess;
  url: string;
  note: string;
  listings: number;
  created_at: Date;
  updated_at: Date;
}

export interface DefaultInput {
  competition_id: string;
  territory: string;
  broadcaster_id: string;
  access: ViewingAccess;
  url: string;
  note: string;
}

export type DefaultOutcome =
  | { outcome: 'created'; id: string; applied: number }
  | {
      outcome:
        | 'no_competition'
        | 'no_territory'
        | 'no_broadcaster'
        | 'no_season'
        | 'not_covered'
        | 'already';
    };

export type BulkOutcome =
  | { outcome: 'listed'; created: string[]; skipped: string[] }
  | { outcome: 'no_territory' | 'no_broadcaster' }
  | { outcome: 'no_fixture' | 'not_covered'; fixtures: string[] };

export interface SeasonCoverageRow {
  competition_id: string;
  competition_name: string;
  short_name: string | null;
  season_id: string | null;
  season_label: string | null;
  coverage: CoverageState | null;
  defaults: number;
}

export interface UpcomingRow {
  id: string;
  kickoff_at: Date;
  status: FixtureStatus;
  season_id: string;
  round: string | null;
  leg: 1 | 2 | null;
  stage_id: string | null;
  stage_name: string | null;
  stage_kind: string | null;
  home_id: string | null;
  home_name: string | null;
  away_id: string | null;
  away_name: string | null;
  covered: boolean;
}

/**
 * Whether the desk declared a season covered for viewing in a territory: the
 * precondition a default and a bulk listing share with the hourly job
 * (`viewing_apply_defaults` says the same in the database).
 */
const COVERED = (season: string, territory: string): string =>
  `EXISTS (SELECT 1 FROM viewing_coverage vc
            WHERE vc.season_id = ${season} AND vc.territory = ${territory}
              AND vc.module = 'viewing' AND vc.state IN ('available', 'limited')
              AND vc.source_id = '${EDITORIAL_SOURCE}')`;

interface Codeful {
  code?: string;
  constraint?: string;
}

interface AuditEntry {
  actorId: string;
  action: string;
  targetType: 'season' | 'broadcaster' | 'fixture' | 'competition';
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
        default_id: string | null;
      }>(
        `DELETE FROM viewing_option WHERE id = $1 AND fixture_id = $2
         RETURNING territory, broadcaster_id, access, url, default_id`,
        [optionId, fixtureId],
      );
      const gone = rows[0];
      if (gone === undefined) return false;
      // A listing a default made is an exception once removed: applying never puts it back (T-1360).
      if (gone.default_id !== null) {
        await client.query(
          `INSERT INTO viewing_default_skip (default_id, fixture_id, created_by, reason)
           VALUES ($1, $2, $3, $4) ON CONFLICT (default_id, fixture_id) DO NOTHING`,
          [gone.default_id, fixtureId, actorId, reason],
        );
      }
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
      if (gone === undefined) return this.withdrawFeedHighlight(client, actorId, fixtureId, reason);
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

  /**
   * A licensed feed's clip taken down by an editor (T-1366, D-184): with no
   * desk page to remove, the match's feed clip is withdrawn -- in every
   * territory, because a wrong clip is wrong everywhere -- and the row stays
   * so the feed never brings it back. False when there is none to withdraw.
   */
  private async withdrawFeedHighlight(
    client: PoolClient,
    actorId: string,
    fixtureId: string,
    reason: string,
  ): Promise<boolean> {
    const { rows } = await client.query<{ id: string; url: string; publisher: string | null }>(
      `UPDATE highlight_feed SET withdrawn_at = now(), withdrawn_reason = $2
        WHERE fixture_id = $1 AND withdrawn_at IS NULL
        RETURNING id, url, publisher`,
      [fixtureId, reason],
    );
    const gone = rows[0];
    if (gone === undefined) return false;
    await record(client, {
      actorId,
      action: 'highlight.withdraw_feed',
      targetType: 'fixture',
      targetId: fixtureId,
      reason,
      previous: { feed_highlight_id: gone.id, url: gone.url, publisher: gone.publisher },
      next: { feed_highlight_id: gone.id, withdrawn: true },
    });
    return true;
  }

  /**
   * Applies the standing defaults (or the one named) through the database's
   * one copy of the rule, `viewing_apply_defaults` (T-1360): how many
   * listings each default created. A default that created none is absent.
   */
  async applyDefaults(
    only: string | null = null,
    client: Pick<PoolClient, 'query'> = this.pool,
  ): Promise<Map<string, number>> {
    const { rows } = await client.query<{ applied_default: string; created: number }>(
      `SELECT applied_default, created FROM viewing_apply_defaults($1::uuid)`,
      [only],
    );
    return new Map(rows.map((r) => [r.applied_default, r.created]));
  }

  async defaults(filter: {
    competition: string | null;
    territory: string | null;
    id?: string;
  }): Promise<DefaultRow[]> {
    const { rows } = await this.pool.query<DefaultRow>(
      `SELECT d.id, d.competition_id, c.name AS competition_name, d.territory,
              b.id AS broadcaster_id, b.name AS broadcaster_name,
              b.homepage_url AS broadcaster_homepage_url, b.kind AS broadcaster_kind,
              d.access, d.url, d.note, d.created_at, d.updated_at,
              (SELECT count(*)::int FROM viewing_option o WHERE o.default_id = d.id) AS listings
         FROM viewing_default d
         JOIN competition c ON c.id = d.competition_id
         JOIN broadcaster b ON b.id = d.broadcaster_id
        WHERE d.removed_at IS NULL
          AND ($1::uuid IS NULL OR d.competition_id = $1)
          AND ($2::text IS NULL OR d.territory = $2)
          AND ($3::uuid IS NULL OR d.id = $3)
        ORDER BY c.name, d.territory, b.name, d.id`,
      [filter.competition, filter.territory, filter.id ?? null],
    );
    return rows;
  }

  /**
   * A default, created and applied in one transaction with its audit row:
   * the default is the signed editorial act (D-181), its listings carry its
   * id. Refused unless the competition's current season is covered in the
   * territory, as a single listing is.
   */
  async createDefault(actorId: string, input: DefaultInput): Promise<DefaultOutcome> {
    return this.transaction(async (client) => {
      const competition = await client.query(`SELECT 1 FROM competition WHERE id = $1`, [
        input.competition_id,
      ]);
      if ((competition.rowCount ?? 0) === 0) return { outcome: 'no_competition' };
      const known = await client.query(`SELECT 1 FROM territory WHERE code = $1`, [
        input.territory,
      ]);
      if ((known.rowCount ?? 0) === 0) return { outcome: 'no_territory' };
      const broadcaster = await client.query(`SELECT 1 FROM broadcaster WHERE id = $1`, [
        input.broadcaster_id,
      ]);
      if ((broadcaster.rowCount ?? 0) === 0) return { outcome: 'no_broadcaster' };
      const season = await client.query<{ id: string; covered: boolean }>(
        `SELECT s.id, ${COVERED('s.id', '$2')} AS covered
           FROM season s WHERE s.competition_id = $1 AND s.is_current`,
        [input.competition_id, input.territory],
      );
      const current = season.rows[0];
      if (current === undefined) return { outcome: 'no_season' };
      if (!current.covered) return { outcome: 'not_covered' };
      let id: string;
      try {
        await client.query('SAVEPOINT viewing_default');
        const { rows } = await client.query<{ id: string }>(
          `INSERT INTO viewing_default
             (competition_id, territory, broadcaster_id, access, url, note, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
          [
            input.competition_id,
            input.territory,
            input.broadcaster_id,
            input.access,
            input.url,
            input.note,
            actorId,
          ],
        );
        id = rows[0]!.id;
      } catch (error) {
        const failed = error as Codeful;
        if (failed.code === '23505' && failed.constraint === 'viewing_default_one_active') {
          await client.query('ROLLBACK TO SAVEPOINT viewing_default');
          return { outcome: 'already' };
        }
        throw error;
      }
      const applied = (await this.applyDefaults(id, client)).get(id) ?? 0;
      await record(client, {
        actorId,
        action: 'viewing.default_set',
        targetType: 'competition',
        targetId: input.competition_id,
        reason: input.note,
        previous: null,
        next: {
          default_id: id,
          territory: input.territory,
          broadcaster_id: input.broadcaster_id,
          access: input.access,
          url: input.url,
          applied,
        },
      });
      return { outcome: 'created', id, applied };
    });
  }

  /**
   * Removes a standing default with a reason: the row stays as history, and
   * its listings for matches not yet kicked off go with it. Those of matches
   * already under way or played stay -- they were true. Null when there is
   * no standing default with that id.
   */
  async removeDefault(
    actorId: string,
    id: string,
    reason: string,
  ): Promise<{ deleted: number } | null> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<{
        competition_id: string;
        territory: string;
        broadcaster_id: string;
        access: ViewingAccess;
        url: string;
        note: string;
      }>(
        `UPDATE viewing_default
            SET removed_at = now(), removed_reason = $2, removed_by = $3
          WHERE id = $1 AND removed_at IS NULL
          RETURNING competition_id, territory, broadcaster_id, access, url, note`,
        [id, reason, actorId],
      );
      const gone = rows[0];
      if (gone === undefined) return null;
      const deleted = await client.query(
        `DELETE FROM viewing_option o USING fixture f
          WHERE o.default_id = $1 AND f.id = o.fixture_id AND f.kickoff_at > now()`,
        [id],
      );
      const count = deleted.rowCount ?? 0;
      await record(client, {
        actorId,
        action: 'viewing.default_removed',
        targetType: 'competition',
        targetId: gone.competition_id,
        reason,
        previous: {
          default_id: id,
          territory: gone.territory,
          broadcaster_id: gone.broadcaster_id,
          access: gone.access,
          url: gone.url,
          note: gone.note,
        },
        next: { default_id: id, removed: true, deleted_listings: count },
      });
      return { deleted: count };
    });
  }

  /**
   * One service on many matches (T-1360): refused whole when a match is
   * unknown or its season is not covered in the territory; a match already
   * listed on that service is skipped and reported. One audit row per
   * listing created, the same row a single listing writes.
   */
  async bulkList(
    actorId: string,
    input: {
      territory: string;
      broadcaster_id: string;
      access: ViewingAccess;
      url: string;
      fixture_ids: string[];
    },
  ): Promise<BulkOutcome> {
    return this.transaction(async (client) => {
      const known = await client.query(`SELECT 1 FROM territory WHERE code = $1`, [
        input.territory,
      ]);
      if ((known.rowCount ?? 0) === 0) return { outcome: 'no_territory' };
      const broadcaster = await client.query(`SELECT 1 FROM broadcaster WHERE id = $1`, [
        input.broadcaster_id,
      ]);
      if ((broadcaster.rowCount ?? 0) === 0) return { outcome: 'no_broadcaster' };
      const { rows: fixtures } = await client.query<{ id: string; covered: boolean }>(
        `SELECT f.id, ${COVERED('f.season_id', '$2')} AS covered
           FROM fixture f WHERE f.id = ANY($1::uuid[])`,
        [input.fixture_ids, input.territory],
      );
      const found = new Set(fixtures.map((f) => f.id));
      const missing = input.fixture_ids.filter((id) => !found.has(id));
      if (missing.length > 0) return { outcome: 'no_fixture', fixtures: missing };
      const uncovered = fixtures.filter((f) => !f.covered).map((f) => f.id);
      if (uncovered.length > 0) return { outcome: 'not_covered', fixtures: uncovered };
      const { rows } = await client.query<{ id: string; fixture_id: string }>(
        `INSERT INTO viewing_option (fixture_id, territory, broadcaster_id, source_id, access, url)
         SELECT f, $2, $3, $4, $5, $6 FROM unnest($1::uuid[]) AS f
         ON CONFLICT ON CONSTRAINT viewing_option_one_per_service DO NOTHING
         RETURNING id, fixture_id`,
        [
          input.fixture_ids,
          input.territory,
          input.broadcaster_id,
          EDITORIAL_SOURCE,
          input.access,
          input.url,
        ],
      );
      for (const row of rows) {
        await record(client, {
          actorId,
          action: 'viewing.list',
          targetType: 'fixture',
          targetId: row.fixture_id,
          reason: 'entered by the editorial desk',
          previous: null,
          next: {
            option_id: row.id,
            territory: input.territory,
            broadcaster_id: input.broadcaster_id,
            access: input.access,
            url: input.url,
          },
        });
      }
      const created = new Set(rows.map((r) => r.fixture_id));
      return {
        outcome: 'listed',
        created: rows.map((r) => r.id),
        skipped: input.fixture_ids.filter((id) => !created.has(id)),
      };
    });
  }

  /** Active competitions (or the one named) with the current season's viewing coverage in a territory. */
  async seasonCoverage(
    territory: string,
    competition: string | null,
  ): Promise<SeasonCoverageRow[]> {
    const { rows } = await this.pool.query<SeasonCoverageRow>(
      `SELECT c.id AS competition_id, c.name AS competition_name, c.short_name,
              s.id AS season_id, s.label AS season_label, vc.state AS coverage,
              (SELECT count(*)::int FROM viewing_default d
                WHERE d.competition_id = c.id AND d.territory = $1
                  AND d.removed_at IS NULL) AS defaults
         FROM competition c
         LEFT JOIN season s ON s.competition_id = c.id AND s.is_current
         LEFT JOIN viewing_coverage vc
           ON vc.season_id = s.id AND vc.territory = $1 AND vc.module = 'viewing'
        WHERE ($2::uuid IS NULL AND c.is_active) OR c.id = $2
        ORDER BY c.name, c.id`,
      [territory, competition],
    );
    return rows;
  }

  /** The competition's matches from three hours ago to `days` ahead, by kickoff, each with whether its season is covered. */
  async upcoming(competition: string, territory: string, days: number): Promise<UpcomingRow[]> {
    const { rows } = await this.pool.query<UpcomingRow>(
      `SELECT f.id, f.kickoff_at, f.status, f.season_id, f.round, f.leg,
              st.id AS stage_id, st.name AS stage_name, st.kind AS stage_kind,
              h.id AS home_id, h.name AS home_name, a.id AS away_id, a.name AS away_name,
              ${COVERED('f.season_id', '$2')} AS covered
         FROM fixture f
         JOIN season s ON s.id = f.season_id
         LEFT JOIN stage st ON st.id = f.stage_id
         LEFT JOIN fixture_participant hp ON hp.fixture_id = f.id AND hp.side = 'home'
         LEFT JOIN team h ON h.id = hp.team_id
         LEFT JOIN fixture_participant ap ON ap.fixture_id = f.id AND ap.side = 'away'
         LEFT JOIN team a ON a.id = ap.team_id
        WHERE s.competition_id = $1
          AND f.kickoff_at >= now() - interval '3 hours'
          AND f.kickoff_at <= now() + make_interval(days => $3::int)
        ORDER BY f.kickoff_at, f.id`,
      [competition, territory, days],
    );
    return rows;
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
