import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type { ForecastKind } from '@fmip/contracts';
import { PG_POOL } from '../../database/database.module';
import { EvaluationService } from './evaluation.service';
import { ForecastService } from './forecast.service';
import { PowerIndexService } from './power-index.service';
import {
  EARLY_WINDOW_DAYS,
  MILLISECONDS_PER_DAY,
  dueKind,
  utcDay,
  type FixtureState,
} from './internal/forecast-triggers';

// The module's public surface for the triggers.
export { EARLY_WINDOW_DAYS, REFRESH_MIN_HOURS, dueKind } from './internal/forecast-triggers';

export interface TriggerReport {
  /** Fixtures inside the window that were considered. */
  considered: number;
  /** Versions written, by kind. */
  computed: Partial<Record<ForecastKind, number>>;
  /** Power Indexes written, one per side. */
  indexes: number;
  /** Fixtures skipped, by reason, so "nothing happened" is explicable. */
  skipped: Record<string, number>;
  /**
   * Of the versions written, those due only because the published model
   * version changed (T-1373, D-191), by the model version they supersede.
   */
  replaced: Record<string, number>;
  /**
   * Of the versions written, those due only because results their fit did
   * not read have been stored since the newest one (T-1377, D-195).
   */
  refreshed: number;
  /** The version the model service publishes, or null when it could not be asked. */
  published_model: string | null;
}

/**
 * Producing each forecast version once, at the moment it is due (T-120).
 *
 * The decision is in `internal/forecast-triggers.ts` and is pure; this service
 * finds the fixtures to ask about and carries out what it is told. It computes
 * the Power Index on the same pass, because the index is part of the same
 * statement about the same moment (blueprint 6.1 sits beside 6.2) and computing
 * them at different times would leave a match centre showing an index from one
 * hour and a forecast from another.
 *
 * Run by the scheduler (T-026) rather than by an ingestion job: producing a
 * forecast is not ingestion, and giving it its own tick keeps it out of the
 * `ingest_run` record, which is about what a provider was asked for.
 */
/** How far back a finished fixture is still scored by the tick, in days. */
export const EVALUATE_WINDOW_DAYS = 14;
/** Fixtures scored per tick at most. */
export const EVALUATE_BATCH = 200;

@Injectable()
export class ForecastTriggersService {
  private readonly log = new Logger('Forecast');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly forecasts: ForecastService,
    private readonly indexes: PowerIndexService,
    private readonly evaluations: EvaluationService,
  ) {}

  /**
   * Scores every finished fixture that still has an available version with no
   * evaluation (T-066), on the same tick. Evaluation was only ever reached from
   * the administrator's `POST /fixtures/:id/evaluations`, so no forecast was
   * scored by itself and no candidate could reach T-535's 300. A fixture is
   * taken while its result can still be corrected upstream (14 days), and at
   * most `EVALUATE_BATCH` a tick so a backlog drains without a long tick.
   */
  async evaluateFinished(now: Date = new Date()): Promise<{ fixtures: number; added: number }> {
    const since = new Date(now.getTime() - EVALUATE_WINDOW_DAYS * MILLISECONDS_PER_DAY);
    const { rows } = await this.pool.query<{ id: string }>(
      `SELECT f.id
         FROM fixture f
        WHERE f.status = 'finished' AND f.kickoff_at >= $1 AND f.kickoff_at <= $2
          AND EXISTS (
            SELECT 1 FROM forecast fc
             WHERE fc.fixture_id = f.id AND fc.status = 'available'
               AND NOT EXISTS (SELECT 1 FROM evaluation e WHERE e.forecast_id = fc.id))
        ORDER BY f.kickoff_at
        LIMIT $3`,
      [since, now, EVALUATE_BATCH],
    );
    let added = 0;
    for (const row of rows) {
      const outcome = await this.evaluations.evaluateFixture(row.id);
      if (outcome.kind === 'evaluated') added += outcome.added;
    }
    return { fixtures: rows.length, added };
  }

  /**
   * Computes whatever is due across the window. Safe to run as often as you like.
   *
   * The model service is asked once which version it publishes (T-1373,
   * D-191), so a fixture whose newest forecast is another version's gets one
   * from the new one; when it cannot be asked, that rule waits for a later
   * tick and every other kind is due as before.
   *
   * The same query finds, per fixture, whether results its newest forecast's
   * fit did not read have been stored since (T-1377, D-195); a fixture with
   * nothing due writes nothing, so a quiet tick is one read.
   */
  async runDue(now: Date = new Date()): Promise<TriggerReport> {
    const states = await this.candidates(now);
    const health = await this.forecasts.modelHealth();
    const publishedModel = health.ok ? health.modelVersion : null;
    const report: TriggerReport = {
      considered: states.length,
      computed: {},
      indexes: 0,
      skipped: {},
      replaced: {},
      refreshed: 0,
      published_model: publishedModel,
    };

    for (const state of states) {
      const due = dueKind(state, now, publishedModel);
      if ('skip' in due) {
        report.skipped[due.skip] = (report.skipped[due.skip] ?? 0) + 1;
        continue;
      }

      const outcome = await this.forecasts.compute(state.fixtureId, due.kind);
      if (outcome.kind !== 'recorded') {
        report.skipped['the fixture disappeared between the query and the computation'] =
          (report.skipped['the fixture disappeared between the query and the computation'] ?? 0) +
          1;
        continue;
      }
      report.computed[due.kind] = (report.computed[due.kind] ?? 0) + 1;
      if (due.replaces !== undefined) {
        report.replaced[due.replaces] = (report.replaced[due.replaces] ?? 0) + 1;
      }
      if (due.refreshes !== undefined) report.refreshed += 1;

      const index = await this.indexes.compute(state.fixtureId, now);
      if (index.kind === 'computed') report.indexes += 2;

      this.log.log(`forecast version computed: ${due.kind}`, {
        event: 'forecast.version_computed',
        fixture_id: state.fixtureId,
        kind: due.kind,
        replaces: due.replaces ?? null,
        refreshes: due.refreshes ?? null,
        power_index: index.kind,
      });
    }
    return report;
  }

  /**
   * Fixtures that could be due: scheduled, kicking off inside the window.
   *
   * The line-up check is `EXISTS`, not a count: one named player on either side
   * is the provider saying the team is known, and waiting for both would leave
   * the final version unwritten whenever the second side is late.
   */
  private async candidates(now: Date): Promise<FixtureState[]> {
    const until = new Date(now.getTime() + EARLY_WINDOW_DAYS * MILLISECONDS_PER_DAY);
    // Midnight UTC today: a fit made now reads results played before it.
    const today = new Date(`${utcDay(now)}T00:00:00Z`);
    const { rows } = await this.pool.query<{
      id: string;
      kickoff_at: Date;
      status: string;
      has_lineup: boolean;
      kinds: string[] | null;
      newest_model: string | null;
      newest_kind: string | null;
      newest_reason: string | null;
      newest_computed_at: Date | null;
      newest_fit_date: string | null;
      newest_result_on: string | null;
    }>(
      `SELECT f.id, f.kickoff_at, f.status,
              EXISTS (
                SELECT 1 FROM lineup l
                  JOIN fixture_participant p ON p.id = l.participant_id
                 WHERE p.fixture_id = f.id
              ) AS has_lineup,
              -- The kind lives on the input snapshot, which is what a version
              -- is made of; the forecast row carries the answer.
              (SELECT array_agg(DISTINCT s.kind)
                 FROM forecast fc
                 JOIN input_snapshot s ON s.id = fc.input_snapshot_id
                WHERE fc.fixture_id = f.id AND fc.role = 'published') AS kinds,
              newest.model_id AS newest_model, newest.kind AS newest_kind,
              newest.unavailable_reason AS newest_reason,
              newest.computed_at AS newest_computed_at, newest.fit_date AS newest_fit_date,
              -- T-1377 (D-195): the newest day either side finished a match the
              -- newest version's fit did not read and a fit made now would: in
              -- the fixture's division, or, for a match between leagues, any
              -- the cross-league fit reads (the model's own-records loader's
              -- scope). Read only, so a tick with nothing to refresh writes
              -- nothing.
              (SELECT to_char(max(g.kickoff_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD')
                 FROM fixture_participant mine
                 JOIN fixture_participant theirs
                   ON theirs.team_id = mine.team_id AND theirs.fixture_id <> f.id
                 JOIN fixture g ON g.id = theirs.fixture_id
                 JOIN season gs ON gs.id = g.season_id
                 JOIN competition gc ON gc.id = gs.competition_id
                WHERE mine.fixture_id = f.id
                  AND newest.fit_date IS NOT NULL
                  AND g.status = 'finished'
                  AND g.kickoff_at >= (newest.fit_date::date + 1)::timestamp AT TIME ZONE 'UTC'
                  AND g.kickoff_at < $3
                  AND EXISTS (SELECT 1 FROM fixture_score sc
                               WHERE sc.fixture_id = g.id AND sc.kind = 'full_time')
                  AND CASE WHEN c.football_data_division IS NOT NULL
                           THEN gc.football_data_division = c.football_data_division
                           ELSE gc.football_data_division IS NOT NULL
                                OR gc.kind <> 'league' OR gc.scope <> 'domestic' END
              ) AS newest_result_on
         FROM fixture f
         JOIN season se ON se.id = f.season_id
         JOIN competition c ON c.id = se.competition_id
         -- The newest published version: which model made it, and its kind
         -- (T-1373, D-191). Published numbering has no gap, so the highest
         -- number is the newest.
         LEFT JOIN LATERAL (
           SELECT m.model_id, s.kind, fc.unavailable_reason, fc.computed_at,
                  -- A malformed date would fail the whole tick; it refreshes nothing.
                  CASE WHEN s.model_inputs->>'fit_date' ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
                       THEN s.model_inputs->>'fit_date' END AS fit_date
             FROM forecast fc
             JOIN model_version m ON m.id = fc.model_version_id
             JOIN input_snapshot s ON s.id = fc.input_snapshot_id
            WHERE fc.fixture_id = f.id AND fc.role = 'published'
            ORDER BY fc.version_number DESC
            LIMIT 1
         ) newest ON true
        WHERE f.status = 'scheduled' AND f.kickoff_at > $1 AND f.kickoff_at <= $2
        ORDER BY f.kickoff_at`,
      [now, until, today],
    );
    return rows.map((row) => ({
      fixtureId: row.id,
      kickoffAt: row.kickoff_at,
      status: row.status,
      hasLineup: row.has_lineup,
      existingKinds: (row.kinds ?? []) as ForecastKind[],
      newestPublished:
        row.newest_model === null || row.newest_kind === null || row.newest_computed_at === null
          ? null
          : {
              modelVersion: row.newest_model,
              kind: row.newest_kind as ForecastKind,
              reason: row.newest_reason,
              computedAt: row.newest_computed_at,
              fitDate: row.newest_fit_date,
            },
      newestResultOn: row.newest_result_on,
    }));
  }
}
