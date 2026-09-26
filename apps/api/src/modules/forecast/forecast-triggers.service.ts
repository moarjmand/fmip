import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type { ForecastKind } from '@fmip/contracts';
import { PG_POOL } from '../../database/database.module';
import { ForecastService } from './forecast.service';
import { PowerIndexService } from './power-index.service';
import {
  EARLY_WINDOW_DAYS,
  MILLISECONDS_PER_DAY,
  dueKind,
  type FixtureState,
} from './internal/forecast-triggers';

// The module's public surface for the triggers.
export { EARLY_WINDOW_DAYS, dueKind } from './internal/forecast-triggers';

export interface TriggerReport {
  /** Fixtures inside the window that were considered. */
  considered: number;
  /** Versions written, by kind. */
  computed: Partial<Record<ForecastKind, number>>;
  /** Power Indexes written, one per side. */
  indexes: number;
  /** Fixtures skipped, by reason, so "nothing happened" is explicable. */
  skipped: Record<string, number>;
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
@Injectable()
export class ForecastTriggersService {
  private readonly log = new Logger('Forecast');

  constructor(
    @Inject(PG_POOL) private readonly pool: Pool,
    private readonly forecasts: ForecastService,
    private readonly indexes: PowerIndexService,
  ) {}

  /** Computes whatever is due across the window. Safe to run as often as you like. */
  async runDue(now: Date = new Date()): Promise<TriggerReport> {
    const states = await this.candidates(now);
    const report: TriggerReport = {
      considered: states.length,
      computed: {},
      indexes: 0,
      skipped: {},
    };

    for (const state of states) {
      const due = dueKind(state, now);
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

      const index = await this.indexes.compute(state.fixtureId, now);
      if (index.kind === 'computed') report.indexes += 2;

      this.log.log(`forecast version computed: ${due.kind}`, {
        event: 'forecast.version_computed',
        fixture_id: state.fixtureId,
        kind: due.kind,
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
    const { rows } = await this.pool.query<{
      id: string;
      kickoff_at: Date;
      status: string;
      has_lineup: boolean;
      kinds: string[] | null;
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
                WHERE fc.fixture_id = f.id AND fc.role = 'published') AS kinds
         FROM fixture f
        WHERE f.status = 'scheduled' AND f.kickoff_at > $1 AND f.kickoff_at <= $2
        ORDER BY f.kickoff_at`,
      [now, until],
    );
    return rows.map((row) => ({
      fixtureId: row.id,
      kickoffAt: row.kickoff_at,
      status: row.status,
      hasLineup: row.has_lineup,
      existingKinds: (row.kinds ?? []) as ForecastKind[],
    }));
  }
}
