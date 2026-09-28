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

/**
 * How stale `last_seen_at` may be while a finding is unchanged: a sweep that
 * sees it again rewrites the row only when its detail changed or this long
 * has passed since it was last written.
 */
export const LAST_SEEN_RESOLUTION_SECONDS = 60 * 60;

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

/** A fixture as the admin page names it: our team names, never a provider's. */
const FIXTURE_REF = (column: string) => `(
  SELECT jsonb_build_object('id', f.id, 'home', th.name, 'away', ta.name,
                            'kickoff_at', f.kickoff_at, 'status', f.status)
    FROM fixture f
    JOIN fixture_participant h ON h.fixture_id = f.id AND h.side = 'home'
    JOIN team th ON th.id = h.team_id
    JOIN fixture_participant a ON a.fixture_id = f.id AND a.side = 'away'
    JOIN team ta ON ta.id = a.team_id
   WHERE f.id = ${column})`;

interface FixtureJson {
  id: string;
  home: string;
  away: string;
  kickoff_at: string;
  status: string;
}

/** One open finding as the admin page reads it. */
export interface FindingRow {
  id: string;
  check_kind: DataQualityCheck;
  detail: string;
  competition_id: string | null;
  competition_name: string | null;
  season_id: string | null;
  season_label: string | null;
  team_id: string | null;
  team_name: string | null;
  fixture: FixtureJson | null;
  related_fixture: FixtureJson | null;
  first_seen_at: Date;
  last_seen_at: Date;
  reviewed_at: Date | null;
  reviewed_by: string | null;
  review_reason: string | null;
}

export interface CountRow {
  competition_id: string | null;
  competition_name: string | null;
  check_kind: DataQualityCheck;
  open: number;
  reviewed: number;
}

export type ReviewOutcome = 'reviewed' | 'not_found' | 'already_reviewed';

/** Every statement the data-quality checks run: reads of the feed's tables, and their own table. */
@Injectable()
export class DataQualityStore {
  constructor(@Inject(PG_POOL) private readonly pool: Pool) {}

  /** Each check's newest run. */
  async checkRuns(): Promise<Map<DataQualityCheck, Date>> {
    const { rows } = await this.pool.query<{ check_kind: DataQualityCheck; checked_at: Date }>(
      `SELECT check_kind, checked_at FROM data_quality_check_run`,
    );
    return new Map(rows.map((r) => [r.check_kind, r.checked_at]));
  }

  /** Open findings with the names the page shows, newest first seen first. */
  async openFindings(limit: number): Promise<FindingRow[]> {
    const { rows } = await this.pool.query<FindingRow>(
      `SELECT d.id, d.check_kind, d.detail,
              c.id AS competition_id, c.name AS competition_name,
              se.id AS season_id, se.label AS season_label,
              t.id AS team_id, t.name AS team_name,
              ${FIXTURE_REF('d.fixture_id')} AS fixture,
              ${FIXTURE_REF('d.related_fixture_id')} AS related_fixture,
              d.first_seen_at, d.last_seen_at,
              d.reviewed_at, u.username AS reviewed_by, d.review_reason
         FROM data_quality_finding d
         LEFT JOIN competition c ON c.id = d.competition_id
         LEFT JOIN season se ON se.id = d.season_id
         LEFT JOIN team t ON t.id = d.team_id
         LEFT JOIN user_account u ON u.id = d.reviewed_by
        WHERE d.resolved_at IS NULL
        ORDER BY d.first_seen_at DESC, d.id DESC
        LIMIT $1`,
      [limit],
    );
    return rows;
  }

  /** Open findings per competition and check, and how many of them are reviewed. */
  async counts(): Promise<CountRow[]> {
    const { rows } = await this.pool.query<CountRow>(
      `SELECT d.competition_id, c.name AS competition_name, d.check_kind,
              count(*)::int AS open,
              (count(*) FILTER (WHERE d.reviewed_at IS NOT NULL))::int AS reviewed
         FROM data_quality_finding d
         LEFT JOIN competition c ON c.id = d.competition_id
        WHERE d.resolved_at IS NULL
        GROUP BY d.competition_id, c.name, d.check_kind
        ORDER BY c.name NULLS LAST, d.check_kind`,
    );
    return rows;
  }

  async resolvedSince(since: Date): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM data_quality_finding WHERE resolved_at >= $1`,
      [since],
    );
    return rows[0]?.n ?? 0;
  }

  /**
   * The watchdog's count (T-821): open, unreviewed findings about a match
   * that is live or kicked off since `horizon`, first seen before `seenBefore`.
   */
  async liveContradictions(horizon: Date, seenBefore: Date): Promise<number> {
    const { rows } = await this.pool.query<{ n: number }>(
      `SELECT count(*)::int AS n
         FROM data_quality_finding d
         JOIN fixture f ON f.id = d.fixture_id
        WHERE d.resolved_at IS NULL
          AND d.reviewed_at IS NULL
          AND d.first_seen_at <= $2
          AND (f.status = 'live' OR f.kickoff_at >= $1)`,
      [horizon, seenBefore],
    );
    return rows[0]?.n ?? 0;
  }

  /**
   * Marks an open finding reviewed, with the reason and an audit row in the
   * same transaction (rule 10). A resolved or unknown finding is `not_found`;
   * one already reviewed keeps its first review.
   */
  async review(id: number, actorId: string, reason: string, now: Date): Promise<ReviewOutcome> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ reviewed_at: Date | null; check_kind: string }>(
        `SELECT reviewed_at, check_kind FROM data_quality_finding
          WHERE id = $1 AND resolved_at IS NULL FOR UPDATE`,
        [id],
      );
      const row = rows[0];
      if (row === undefined || row.reviewed_at !== null) {
        await client.query('ROLLBACK');
        return row === undefined ? 'not_found' : 'already_reviewed';
      }
      await client.query(
        `UPDATE data_quality_finding
            SET reviewed_at = $2, reviewed_by = $3, review_reason = $4
          WHERE id = $1`,
        [id, now, actorId, reason],
      );
      await client.query(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
         VALUES ($1, 'data_quality.review', 'data_quality_finding', $2, $3, $4::jsonb, $5::jsonb)`,
        [
          actorId,
          String(id),
          reason,
          JSON.stringify({ check: row.check_kind, reviewed: false }),
          JSON.stringify({ check: row.check_kind, reviewed: true }),
        ],
      );
      await client.query('COMMIT');
      return 'reviewed';
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

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
               -- An unchanged finding is rewritten at most hourly: thousands of
               -- them every five minutes would be write traffic for nothing
               -- (data_quality_check_run says exactly when the check last ran).
               WHERE data_quality_finding.detail IS DISTINCT FROM EXCLUDED.detail
                  OR data_quality_finding.last_seen_at
                       <= EXCLUDED.last_seen_at - make_interval(secs => $10::int)
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
          LAST_SEEN_RESOLUTION_SECONDS,
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
