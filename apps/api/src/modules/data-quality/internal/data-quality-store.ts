import { Inject, Injectable } from '@nestjs/common';
import type { DataQualityCheck } from '@fmip/contracts';
import type { Pool, PoolClient } from 'pg';
import { PG_POOL } from '../../../database/database.module';
import {
  DUPLICATE_WINDOW_DAYS,
  type Finding,
  type GoalsRow,
  LIVE_OVERRUN_MINUTES,
  type LineupRow,
  type LiveRow,
  type MappingRow,
  type PairRow,
  type ScoreKindsRow,
} from './checks';

/**
 * The key of the transaction-scoped advisory lock one write holds (T-820):
 * a sweep and the standings job's table comparison never resolve each
 * other's rows halfway through, and two sweeping processes do not both write.
 */
export const DATA_QUALITY_LOCK = 820_820;

/** The rows each check reads. One statement per check, over stored data only. */
export interface CheckRows {
  scores: ScoreKindsRow[];
  goals: GoalsRow[];
  live: LiveRow[];
  lineups: LineupRow[];
  mappings: MappingRow[];
  pairs: PairRow[];
}

/** What one write did. */
export interface WriteOutcome {
  opened: number;
  seen: number;
  resolved: number;
}

const REF = 'f.id AS "fixtureId", f.season_id AS "seasonId", s.competition_id AS "competitionId"';

/** Every statement the data-quality checks run: reads of the feed's tables, and their own table. */
@Injectable()
export class DataQualityStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** The rows every swept check judges, read in parallel outside any transaction. */
  async read(now: Date): Promise<CheckRows> {
    const [scores, goals, live, lineups, mappings, pairs] = await Promise.all([
      this.pool.query<ScoreKindsRow>(
        `SELECT ${REF}, f.status,
                COALESCE(array_agg(sc.kind) FILTER (WHERE sc.kind IS NOT NULL), '{}') AS kinds
           FROM fixture f
           JOIN season s ON s.id = f.season_id
           LEFT JOIN fixture_score sc ON sc.fixture_id = f.id
          WHERE f.status = 'finished'
            AND NOT EXISTS (SELECT 1 FROM fixture_score x
                             WHERE x.fixture_id = f.id AND x.kind = 'full_time')
          GROUP BY f.id, s.competition_id`,
      ),
      this.pool.query<GoalsRow>(
        `WITH timeline AS (
           SELECT i.fixture_id,
                  count(*)::int AS incidents,
                  COALESCE(jsonb_agg(jsonb_build_object('kind', i.kind, 'side', p.side, 'minute', i.minute)
                                     ORDER BY i.sequence)
                             FILTER (WHERE i.kind IN ('goal', 'own_goal', 'penalty_goal')),
                           '[]'::jsonb) AS goals
             FROM incident i
             JOIN fixture f ON f.id = i.fixture_id AND f.status IN ('live', 'finished')
             LEFT JOIN fixture_participant p ON p.id = i.participant_id
            GROUP BY i.fixture_id
         )
         SELECT ${REF}, f.status, t.incidents, t.goals,
                COALESCE((SELECT jsonb_object_agg(sc.kind, jsonb_build_object('home', sc.home, 'away', sc.away))
                            FROM fixture_score sc WHERE sc.fixture_id = f.id), '{}'::jsonb) AS scores
           FROM timeline t
           JOIN fixture f ON f.id = t.fixture_id
           JOIN season s ON s.id = f.season_id`,
      ),
      this.pool.query<LiveRow>(
        `SELECT ${REF}, f.status, f.kickoff_at AS "kickoffAt", f.minute
           FROM fixture f
           JOIN season s ON s.id = f.season_id
          WHERE f.status = 'live'
            AND f.kickoff_at <= $1::timestamptz - make_interval(mins => $2::int)`,
        [now, LIVE_OVERRUN_MINUTES],
      ),
      this.pool.query<LineupRow>(
        `SELECT ${REF}, p.side, p.team_id AS "teamId",
                (count(*) FILTER (WHERE l.role = 'starter'))::int AS starters,
                (count(*) FILTER (WHERE l.role = 'bench'))::int AS bench
           FROM lineup l
           JOIN fixture_participant p ON p.id = l.participant_id
           JOIN fixture f ON f.id = p.fixture_id
           JOIN season s ON s.id = f.season_id
          GROUP BY f.id, s.competition_id, p.id
         HAVING count(*) FILTER (WHERE l.role = 'starter') <> 11`,
      ),
      this.pool.query<MappingRow>(
        `SELECT ${REF}, m.provider, count(*)::int AS ids
           FROM provider_mapping m
           JOIN fixture f ON f.id = m.internal_id
           JOIN season s ON s.id = f.season_id
          WHERE m.entity_type = 'fixture'
          GROUP BY f.id, s.competition_id, m.provider
         HAVING count(*) > 1`,
      ),
      this.pool.query<PairRow>(
        `SELECT ${REF}, g.id AS "otherFixtureId",
                f.kickoff_at AS "kickoffAt", g.kickoff_at AS "otherKickoffAt",
                f.status, g.status AS "otherStatus"
           FROM fixture_participant fh
           JOIN fixture_participant gh
             ON gh.team_id = fh.team_id AND gh.side = 'home' AND gh.fixture_id > fh.fixture_id
           JOIN fixture f ON f.id = fh.fixture_id
           JOIN fixture g ON g.id = gh.fixture_id AND g.season_id = f.season_id
           JOIN fixture_participant fa ON fa.fixture_id = f.id AND fa.side = 'away'
           JOIN fixture_participant ga
             ON ga.fixture_id = g.id AND ga.side = 'away' AND ga.team_id = fa.team_id
           JOIN season s ON s.id = f.season_id
          WHERE fh.side = 'home'
            AND f.status <> 'cancelled' AND g.status <> 'cancelled'
            AND abs(extract(epoch FROM g.kickoff_at - f.kickoff_at)) <= $1::int * 86400`,
        [DUPLICATE_WINDOW_DAYS],
      ),
    ]);
    return {
      scores: scores.rows,
      goals: goals.rows,
      live: live.rows,
      lineups: lineups.rows,
      mappings: mappings.rows,
      pairs: pairs.rows,
    };
  }

  /** The competition a season belongs to, or `null` when the season is gone. */
  async competitionOf(seasonId: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ competition_id: string }>(
      `SELECT competition_id FROM season WHERE id = $1`,
      [seasonId],
    );
    return rows[0]?.competition_id ?? null;
  }

  /**
   * Runs `work` inside one transaction holding the data-quality lock, waiting
   * for it: a table comparison arriving mid-sweep writes after it, not never.
   */
  async locked<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock($1)', [DATA_QUALITY_LOCK]);
      const result = await work(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Records what one run of some checks found, over one scope: every finding
   * is opened or has its `last_seen_at` moved on (never a second row, by the
   * partial unique index), and every unresolved finding of those checks in
   * that scope that was not found this time is resolved. Each check's
   * `checked_at` moves on, so no findings is never read as not checked.
   *
   * `seasonId` narrows the scope to one season (the standings job compares
   * one season's table at a time); `null` is every season (a sweep).
   */
  async record(
    client: PoolClient,
    checks: readonly DataQualityCheck[],
    seasonId: string | null,
    findings: readonly Finding[],
    now: Date,
  ): Promise<WriteOutcome> {
    let opened = 0;
    if (findings.length > 0) {
      const { rows } = await client.query<{ inserted: boolean }>(
        `INSERT INTO data_quality_finding
           (check_kind, subject_key, fixture_id, related_fixture_id, team_id, season_id,
            competition_id, detail, first_seen_at, last_seen_at)
         SELECT c, k, fx, rf, tm, se, co, d, $9::timestamptz, $9::timestamptz
           FROM unnest($1::text[], $2::text[], $3::uuid[], $4::uuid[], $5::uuid[], $6::uuid[],
                       $7::uuid[], $8::text[]) AS u(c, k, fx, rf, tm, se, co, d)
         ON CONFLICT (check_kind, subject_key) WHERE resolved_at IS NULL
         DO UPDATE SET last_seen_at = GREATEST(data_quality_finding.last_seen_at, EXCLUDED.last_seen_at),
                       detail = EXCLUDED.detail
         RETURNING (xmax = 0) AS inserted`,
        [
          findings.map((f) => f.check),
          findings.map((f) => f.subjectKey),
          findings.map((f) => f.fixtureId),
          findings.map((f) => f.relatedFixtureId),
          findings.map((f) => f.teamId),
          findings.map((f) => f.seasonId),
          findings.map((f) => f.competitionId),
          findings.map((f) => f.detail),
          now,
        ],
      );
      opened = rows.filter((r) => r.inserted).length;
    }
    const resolved = await client.query(
      `UPDATE data_quality_finding d
          SET resolved_at = GREATEST(d.last_seen_at, $4::timestamptz)
        WHERE d.resolved_at IS NULL
          AND d.check_kind = ANY($1::text[])
          AND ($2::uuid IS NULL OR d.season_id = $2::uuid)
          AND NOT EXISTS (
                SELECT 1 FROM unnest($3::text[], $5::text[]) AS seen(c, k)
                 WHERE seen.c = d.check_kind AND seen.k = d.subject_key)`,
      [checks, seasonId, findings.map((f) => f.check), now, findings.map((f) => f.subjectKey)],
    );
    await client.query(
      `INSERT INTO data_quality_check_run (check_kind, checked_at)
       SELECT unnest($1::text[]), $2::timestamptz
       ON CONFLICT (check_kind)
       DO UPDATE SET checked_at = GREATEST(data_quality_check_run.checked_at, EXCLUDED.checked_at)`,
      [checks, now],
    );
    return { opened, seen: findings.length - opened, resolved: resolved.rowCount ?? 0 };
  }
}
