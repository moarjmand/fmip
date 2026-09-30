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
import type { CoverageCandidateRow } from './coverage-proposals';

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
  asked_again: { requested_at: string; fetched_at: string | null; changed: boolean | null } | null;
}

export interface CountRow {
  competition_id: string | null;
  competition_name: string | null;
  season_id: string | null;
  season_label: string | null;
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
              d.reviewed_at, u.username AS reviewed_by, d.review_reason,
              (SELECT jsonb_build_object('requested_at', r.requested_at,
                                         'fetched_at', r.fetched_at, 'changed', r.changed)
                 FROM fixture_refetch_request r
                WHERE r.fixture_id = d.fixture_id
                ORDER BY r.requested_at DESC, r.id DESC
                LIMIT 1) AS asked_again
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

  /** Open findings per competition, season and check, and how many of them are reviewed. */
  async counts(): Promise<CountRow[]> {
    const { rows } = await this.pool.query<CountRow>(
      `SELECT d.competition_id, c.name AS competition_name,
              d.season_id, se.label AS season_label, d.check_kind,
              count(*)::int AS open,
              (count(*) FILTER (WHERE d.reviewed_at IS NOT NULL))::int AS reviewed
         FROM data_quality_finding d
         LEFT JOIN competition c ON c.id = d.competition_id
         LEFT JOIN season se ON se.id = d.season_id
        WHERE d.resolved_at IS NULL
        GROUP BY d.competition_id, c.name, d.season_id, se.label, d.check_kind
        ORDER BY c.name NULLS LAST, se.label DESC NULLS LAST, d.check_kind`,
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

  /**
   * Marks every open, not yet reviewed finding of one check in one season
   * reviewed with one reason (T-912), and writes one audit row for the batch
   * in the same transaction: the check, the season, the count and the reason,
   * with the finding ids as the previous value (rule 10). Returns how many
   * were marked; 0 writes nothing, not even the audit row.
   *
   * Only the rows open now are marked. A finding that resolves and is found
   * again later is a new row (the partial unique index), so it is open and
   * unreviewed again, not hidden by an earlier batch.
   */
  async reviewBatch(
    check: DataQualityCheck,
    seasonId: string,
    actorId: string,
    reason: string,
    now: Date,
  ): Promise<number> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<{ id: string }>(
        `UPDATE data_quality_finding
            SET reviewed_at = $3, reviewed_by = $4, review_reason = $5
          WHERE resolved_at IS NULL AND reviewed_at IS NULL
            AND check_kind = $1 AND season_id = $2
          RETURNING id`,
        [check, seasonId, now, actorId, reason],
      );
      if (rows.length === 0) {
        await client.query('ROLLBACK');
        return 0;
      }
      const ids = rows.map((r) => Number(r.id)).sort((a, b) => a - b);
      await client.query(
        `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
         VALUES ($1, 'data_quality.review_batch', 'season', $2, $3, $4::jsonb, $5::jsonb)`,
        [
          actorId,
          seasonId,
          reason,
          JSON.stringify({ check, season_id: seasonId, reviewed: false, finding_ids: ids }),
          JSON.stringify({ check, season_id: seasonId, reviewed: true, count: ids.length }),
        ],
      );
      await client.query('COMMIT');
      return ids.length;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Queues a re-ask of the feed (T-913, D-110) for one fixture, or for every
   * fixture behind one check's open findings in one season, with one audit
   * row in the same transaction naming the fixtures queued (rule 10). Only a
   * fixture some provider has an id for can be asked about. A fixture already
   * waiting is not queued twice. `null`: nothing to ask about.
   */
  async requestRefetch(
    target: { fixtureId: string } | { check: DataQualityCheck; seasonId: string },
    actorId: string,
    reason: string,
    now: Date,
  ): Promise<{ queued: string[]; alreadyQueued: number } | null> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const byFixture = 'fixtureId' in target;
      const { rows: askable } = await client.query<{ fixture_id: string }>(
        byFixture
          ? `SELECT f.id AS fixture_id FROM fixture f
              WHERE f.id = $1
                AND EXISTS (SELECT 1 FROM provider_mapping m
                             WHERE m.entity_type = 'fixture' AND m.internal_id = f.id)`
          : `SELECT DISTINCT d.fixture_id FROM data_quality_finding d
              WHERE d.resolved_at IS NULL AND d.check_kind = $1 AND d.season_id = $2
                AND d.fixture_id IS NOT NULL
                AND EXISTS (SELECT 1 FROM provider_mapping m
                             WHERE m.entity_type = 'fixture' AND m.internal_id = d.fixture_id)
              ORDER BY d.fixture_id`,
        byFixture ? [target.fixtureId] : [target.check, target.seasonId],
      );
      if (askable.length === 0) {
        await client.query('ROLLBACK');
        return null;
      }
      const check = byFixture ? null : target.check;
      const seasonId = byFixture ? null : target.seasonId;
      const { rows: queued } = await client.query<{ fixture_id: string }>(
        `INSERT INTO fixture_refetch_request
           (fixture_id, requested_by, requested_at, reason, check_kind, season_id)
         SELECT f, $2, $3, $4, $5, $6 FROM unnest($1::uuid[]) AS f
         ON CONFLICT (fixture_id) WHERE fetched_at IS NULL DO NOTHING
         RETURNING fixture_id`,
        [askable.map((r) => r.fixture_id), actorId, now, reason, check, seasonId],
      );
      const ids = queued.map((r) => r.fixture_id).sort();
      if (ids.length > 0) {
        await client.query(
          `INSERT INTO audit_log (actor_id, action, target_type, target_id, reason, previous, next)
           VALUES ($1, 'data_quality.refetch', $2, $3, $4, $5::jsonb, $6::jsonb)`,
          [
            actorId,
            byFixture ? 'fixture' : 'season',
            byFixture ? target.fixtureId : target.seasonId,
            reason,
            JSON.stringify({ queued: false, check, season_id: seasonId }),
            JSON.stringify({ queued: true, check, season_id: seasonId, fixture_ids: ids }),
          ],
        );
      }
      await client.query('COMMIT');
      return { queued: ids, alreadyQueued: askable.length - ids.length };
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Waiting re-asks of fixtures in these competitions that this provider has
   * an id for, oldest request first: what the post-match job carries next.
   */
  async refetchesDue(
    provider: string,
    competitionIds: readonly string[],
    limit: number,
  ): Promise<{ id: string; fixtureId: string; externalId: string; competitionId: string }[]> {
    if (limit <= 0 || competitionIds.length === 0) return [];
    const { rows } = await this.pool.query<{
      id: string;
      fixtureId: string;
      externalId: string;
      competitionId: string;
    }>(
      `SELECT r.id::text AS id, r.fixture_id AS "fixtureId", m.external_id AS "externalId",
              s.competition_id AS "competitionId"
         FROM fixture_refetch_request r
         JOIN fixture f ON f.id = r.fixture_id
         JOIN season s ON s.id = f.season_id
         -- One id per fixture: a fixture carrying two (fixture_mapped_twice) is asked once.
         JOIN LATERAL (SELECT pm.external_id FROM provider_mapping pm
                        WHERE pm.internal_id = f.id AND pm.entity_type = 'fixture'
                          AND pm.provider = $1
                        ORDER BY pm.external_id LIMIT 1) m ON true
        WHERE r.fetched_at IS NULL AND s.competition_id = ANY($2::uuid[])
        ORDER BY r.requested_at, r.id
        LIMIT $3`,
      [provider, competitionIds, limit],
    );
    return rows;
  }

  /** Records that the job asked the feed for a queued fixture, and whether the answer changed anything. */
  async recordRefetch(id: string, changed: boolean): Promise<void> {
    await this.pool.query(
      `UPDATE fixture_refetch_request
          SET fetched_at = GREATEST(now(), requested_at), changed = $2
        WHERE id = $1 AND fetched_at IS NULL`,
      [id, changed],
    );
  }

  /** Re-asks still waiting, and those carried since `since`. */
  async refetchCounts(since: Date): Promise<{ pending: number; fetched: number }> {
    const { rows } = await this.pool.query<{ pending: number; fetched: number }>(
      `SELECT (count(*) FILTER (WHERE fetched_at IS NULL))::int AS pending,
              (count(*) FILTER (WHERE fetched_at >= $1))::int AS fetched
         FROM fixture_refetch_request
        WHERE fetched_at IS NULL OR fetched_at >= $1`,
      [since],
    );
    return rows[0] ?? { pending: 0, fetched: 0 };
  }

  /**
   * One row per past season and check (`lineup_not_eleven`, `goals_disagree`)
   * with an open finding about a finished match: the counts D-109 judges a
   * season's coverage on (T-914). A match counts as still short after a
   * re-ask when a re-ask of it was fetched after the finding was first seen.
   * The people waiting are those of every provider that fetched the season's
   * details: `unresolved_entity` does not say which season a person played in.
   */
  async coverageCandidates(): Promise<CoverageCandidateRow[]> {
    const { rows } = await this.pool.query<CoverageCandidateRow>(
      `WITH short AS (
         SELECT d.season_id, d.check_kind,
                count(DISTINCT d.fixture_id)::int AS open,
                (count(DISTINCT d.fixture_id) FILTER (WHERE EXISTS (
                   SELECT 1 FROM fixture_refetch_request r
                    WHERE r.fixture_id = d.fixture_id
                      AND r.fetched_at IS NOT NULL
                      AND r.fetched_at >= d.first_seen_at)))::int AS open_after_reask
           FROM data_quality_finding d
           JOIN fixture f ON f.id = d.fixture_id AND f.status = 'finished'
           JOIN season se ON se.id = d.season_id AND NOT se.is_current
          WHERE d.resolved_at IS NULL
            AND d.check_kind IN ('lineup_not_eleven', 'goals_disagree')
          GROUP BY d.season_id, d.check_kind
       ),
       played AS (
         SELECT f.season_id,
                count(*)::int AS finished,
                count(dff.fixture_id)::int AS fetched,
                mode() WITHIN GROUP (ORDER BY dff.provider) AS fetch_provider,
                array_remove(array_agg(DISTINCT dff.provider), NULL) AS providers
           FROM fixture f
           LEFT JOIN fixture_detail_fetch dff ON dff.fixture_id = f.id
          WHERE f.status = 'finished'
            AND f.season_id IN (SELECT season_id FROM short)
          GROUP BY f.season_id
       )
       SELECT s.season_id, se.label AS season_label,
              c.id AS competition_id, c.name AS competition_name,
              s.check_kind, p.finished, p.fetched, s.open, s.open_after_reask,
              p.fetch_provider,
              (SELECT count(*)::int FROM unresolved_entity u
                WHERE u.status = 'pending' AND u.entity_type = 'person'
                  AND u.provider = ANY (p.providers)) AS pending_people,
              cp.state AS coverage_state, cp.provider AS coverage_provider,
              cp.note AS coverage_note
         FROM short s
         JOIN played p ON p.season_id = s.season_id
         JOIN season se ON se.id = s.season_id
         JOIN competition c ON c.id = se.competition_id
         LEFT JOIN coverage_profile cp
           ON cp.season_id = s.season_id
          AND cp.module = CASE s.check_kind WHEN 'lineup_not_eleven' THEN 'lineups' ELSE 'incidents' END
        ORDER BY c.name, se.label DESC, s.check_kind`,
    );
    return rows;
  }

  /**
   * The rows every swept check judges, read in parallel outside any
   * transaction. `seasonId` narrows every statement to one season's fixtures;
   * `null` is every stored fixture (the scheduled sweep).
   */
  async read(now: Date, seasonId: string | null = null): Promise<CheckRows> {
    const inScope = (n: number) => `($${n}::uuid IS NULL OR f.season_id = $${n}::uuid)`;
    const [scores, goals, live, lineups, mappings, pairs] = await Promise.all([
      this.pool.query<ScoreKindsRow>(
        `SELECT ${REF}, f.status,
                COALESCE(array_agg(sc.kind) FILTER (WHERE sc.kind IS NOT NULL), '{}') AS kinds
           FROM fixture f
           JOIN season s ON s.id = f.season_id
           LEFT JOIN fixture_score sc ON sc.fixture_id = f.id
          WHERE f.status = 'finished'
            AND ${inScope(1)}
            AND NOT EXISTS (SELECT 1 FROM fixture_score x
                             WHERE x.fixture_id = f.id AND x.kind = 'full_time')
          GROUP BY f.id, s.competition_id`,
        [seasonId],
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
                           AND ${inScope(1)}
             LEFT JOIN fixture_participant p ON p.id = i.participant_id
            GROUP BY i.fixture_id
         )
         SELECT ${REF}, f.status, t.incidents, t.goals,
                COALESCE((SELECT jsonb_object_agg(sc.kind, jsonb_build_object('home', sc.home, 'away', sc.away))
                            FROM fixture_score sc WHERE sc.fixture_id = f.id), '{}'::jsonb) AS scores
           FROM timeline t
           JOIN fixture f ON f.id = t.fixture_id
           JOIN season s ON s.id = f.season_id`,
        [seasonId],
      ),
      this.pool.query<LiveRow>(
        `SELECT ${REF}, f.status, f.kickoff_at AS "kickoffAt", f.minute
           FROM fixture f
           JOIN season s ON s.id = f.season_id
          WHERE f.status = 'live'
            AND ${inScope(3)}
            AND f.kickoff_at <= $1::timestamptz - make_interval(mins => $2::int)`,
        [now, LIVE_OVERRUN_MINUTES, seasonId],
      ),
      this.pool.query<LineupRow>(
        `SELECT ${REF}, p.side, p.team_id AS "teamId",
                (count(*) FILTER (WHERE l.role = 'starter'))::int AS starters,
                (count(*) FILTER (WHERE l.role = 'bench'))::int AS bench
           FROM lineup l
           JOIN fixture_participant p ON p.id = l.participant_id
           JOIN fixture f ON f.id = p.fixture_id
           JOIN season s ON s.id = f.season_id
          WHERE ${inScope(1)}
          GROUP BY f.id, s.competition_id, p.id
         HAVING count(*) FILTER (WHERE l.role = 'starter') <> 11`,
        [seasonId],
      ),
      this.pool.query<MappingRow>(
        `SELECT ${REF}, m.provider, count(*)::int AS ids
           FROM provider_mapping m
           JOIN fixture f ON f.id = m.internal_id
           JOIN season s ON s.id = f.season_id
          WHERE m.entity_type = 'fixture'
            AND ${inScope(1)}
          GROUP BY f.id, s.competition_id, m.provider
         HAVING count(*) > 1`,
        [seasonId],
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
            AND ${inScope(2)}
            AND f.status <> 'cancelled' AND g.status <> 'cancelled'
            AND abs(extract(epoch FROM g.kickoff_at - f.kickoff_at)) <= $1::int * 86400`,
        [DUPLICATE_WINDOW_DAYS, seasonId],
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
