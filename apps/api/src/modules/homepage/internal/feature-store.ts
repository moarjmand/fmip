import { Inject, Injectable } from '@nestjs/common';
import { HOMEPAGE_FEATURE_LIMIT } from '@fmip/contracts';
import { Pool, type PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';

export interface FeatureRow {
  fixture_id: string;
  home: string;
  away: string;
  kickoff_at: Date;
  featured_by: string;
  note: string;
  featured_at: Date;
  ends_at: Date;
  cleared_by: string | null;
  cleared_reason: string | null;
  cleared_at: Date | null;
  live: boolean;
}

export interface LiveFeatureRow {
  fixture_id: string;
  note: string;
  featured_at: Date;
  ends_at: Date;
}

export type FeatureOutcome =
  | { kind: 'featured'; featureId: string; endsAt: Date }
  | { kind: 'already' }
  | { kind: 'not_open'; status: string }
  | { kind: 'no_fixture' };

/** A match can be featured while it is still to be played or in play. */
const FEATURABLE = ['scheduled', 'live'];

/**
 * Featured matches on the homepage (T-1161, D-153): featuring and clearing,
 * each with its `audit_log` row in the same transaction (rule 10), target
 * type `fixture`. One feature in force per match is kept here, under the
 * match's row lock, because "in force" is `ends_at > now()` and no index can
 * say that.
 */
@Injectable()
export class PostgresFeatureStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  async feature(
    fixtureId: string,
    actorId: string,
    note: string,
    hours: number,
  ): Promise<FeatureOutcome> {
    return this.transaction(async (client) => {
      const fixture = await client.query<{ status: string }>(
        `SELECT status FROM fixture WHERE id = $1 FOR UPDATE`,
        [fixtureId],
      );
      const status = fixture.rows[0]?.status;
      if (status === undefined) return { kind: 'no_fixture' };
      if (!FEATURABLE.includes(status)) return { kind: 'not_open', status };
      const live = await client.query(
        `SELECT 1 FROM homepage_feature
          WHERE fixture_id = $1 AND cleared_at IS NULL AND ends_at > now()`,
        [fixtureId],
      );
      if ((live.rowCount ?? 0) > 0) return { kind: 'already' };
      const previous = await client.query<{
        id: string;
        note: string;
        ends_at: Date;
        cleared_at: Date | null;
      }>(
        `SELECT id, note, ends_at, cleared_at FROM homepage_feature
          WHERE fixture_id = $1 ORDER BY featured_at DESC LIMIT 1`,
        [fixtureId],
      );
      const { rows } = await client.query<{ id: string; ends_at: Date }>(
        `INSERT INTO homepage_feature (fixture_id, featured_by, note, ends_at)
         VALUES ($1, $2, $3, now() + make_interval(hours => $4))
         RETURNING id, ends_at`,
        [fixtureId, actorId, note, hours],
      );
      const last = previous.rows[0];
      const feature = rows[0]!;
      await audit(client, {
        actorId,
        action: 'homepage_feature.feature',
        fixtureId,
        reason: note,
        previous:
          last === undefined
            ? null
            : {
                feature_id: last.id,
                note: last.note,
                ends_at: last.ends_at.toISOString(),
                cleared_at: last.cleared_at?.toISOString() ?? null,
              },
        next: { feature_id: feature.id, note, hours, ends_at: feature.ends_at.toISOString() },
      });
      return { kind: 'featured', featureId: feature.id, endsAt: feature.ends_at };
    });
  }

  /** Clears the feature in force; false when none is (an expired one has nothing left to clear). */
  async clear(fixtureId: string, actorId: string, reason: string): Promise<boolean> {
    return this.transaction(async (client) => {
      const { rows } = await client.query<{
        id: string;
        note: string;
        featured_at: Date;
        ends_at: Date;
      }>(
        `UPDATE homepage_feature
            SET cleared_at = now(), cleared_by = $2, cleared_reason = $3
          WHERE fixture_id = $1 AND cleared_at IS NULL AND ends_at > now()
          RETURNING id, note, featured_at, ends_at`,
        [fixtureId, actorId, reason],
      );
      const cleared = rows[0];
      if (cleared === undefined) return false;
      await audit(client, {
        actorId,
        action: 'homepage_feature.clear',
        fixtureId,
        reason,
        previous: {
          feature_id: cleared.id,
          note: cleared.note,
          featured_at: cleared.featured_at.toISOString(),
          ends_at: cleared.ends_at.toISOString(),
        },
        next: { feature_id: cleared.id, cleared: true },
      });
      return true;
    });
  }

  /** The features in force now, newest first: what the homepage reads at render. */
  async live(): Promise<LiveFeatureRow[]> {
    const { rows } = await this.pool.query<LiveFeatureRow>(
      `SELECT fixture_id, note, featured_at, ends_at
         FROM homepage_feature
        WHERE cleared_at IS NULL AND ends_at > now()
        ORDER BY featured_at DESC
        LIMIT $1`,
      [HOMEPAGE_FEATURE_LIMIT],
    );
    return rows;
  }

  async list(limit: number): Promise<FeatureRow[]> {
    const { rows } = await this.pool.query<FeatureRow>(
      `SELECT h.fixture_id,
              COALESCE(home.name, 'unknown') AS home,
              COALESCE(away.name, 'unknown') AS away,
              f.kickoff_at,
              ft.username AS featured_by, h.note, h.featured_at, h.ends_at,
              clr.username AS cleared_by, h.cleared_reason, h.cleared_at,
              (h.cleared_at IS NULL AND h.ends_at > now()) AS live
         FROM homepage_feature h
         JOIN fixture f ON f.id = h.fixture_id
         JOIN user_account ft ON ft.id = h.featured_by
         LEFT JOIN user_account clr ON clr.id = h.cleared_by
         LEFT JOIN fixture_participant hp ON hp.fixture_id = f.id AND hp.side = 'home'
         LEFT JOIN team home ON home.id = hp.team_id
         LEFT JOIN fixture_participant ap ON ap.fixture_id = f.id AND ap.side = 'away'
         LEFT JOIN team away ON away.id = ap.team_id
        ORDER BY h.featured_at DESC
        LIMIT $1`,
      [limit],
    );
    return rows;
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

async function audit(
  client: PoolClient,
  entry: {
    actorId: string;
    action: string;
    fixtureId: string;
    reason: string;
    previous: Record<string, unknown> | null;
    next: Record<string, unknown>;
  },
): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
     VALUES ($1, $2, 'fixture', $3, $4, $5::jsonb, $6::jsonb)`,
    [
      entry.actorId,
      entry.action,
      entry.fixtureId,
      entry.reason,
      entry.previous === null ? null : JSON.stringify(entry.previous),
      JSON.stringify(entry.next),
    ],
  );
}
