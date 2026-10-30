import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import { PG_POOL } from '../../database/database.module';
import { IngestRunsService } from './ingest-runs.service';
import {
  absenceHistoryTotals,
  sweepAbsenceHistory,
  type AbsenceHistoryFilter,
  type AbsenceHistorySweep,
  type AbsenceSeasonLine,
} from './internal/absence-history';
import { AbsenceHistoryStore } from './internal/absence-history-store';
import { AskPacer } from './internal/ask-pacer';
import { DEFAULT_TIER_SHARES, parseTierShares } from './internal/budget-tier';
import { INGESTION_SOURCES, type IngestionSources } from './internal/sources';

export type { AbsenceHistoryFilter, AbsenceHistorySweep, AbsenceSeasonLine };
/** The summary the operator's command prints (T-1650). */
export { absenceHistoryTotals, describeLine } from './internal/absence-history';

/** The job name the run is recorded under in `ingest_run`; not scheduled. */
export const ABSENCE_HISTORY_JOB = 'absence_history';

/** Postgres unique violation: the open-run lock on `ingest_run`. */
const UNIQUE_VIOLATION = '23505';

/**
 * Past seasons' absences for the training store (T-1650, D-306), run by the
 * operator's command `dist/cli/absence-history.js` and never scheduled. The
 * run is an `ingest_run` row of its own job, so its requests are counted in
 * the day's budget and shown on `/health/ingestion`; it draws on the bulk
 * tier. Nothing it writes is read by a route or the web app.
 */
@Injectable()
export class AbsenceHistoryService {
  private readonly log = new Logger('Ingestion');
  private readonly store: AbsenceHistoryStore;

  constructor(
    @Inject(PG_POOL) pool: Pool,
    @Inject(INGESTION_SOURCES) private readonly sources: IngestionSources,
    private readonly runs: IngestRunsService,
  ) {
    this.store = new AbsenceHistoryStore(pool);
  }

  /** Who asked for the run and why (rule 10); written before a request is spent. */
  audit(actorId: string, reason: string, filter: AbsenceHistoryFilter): Promise<void> {
    return this.store.audit(actorId, reason, filter);
  }

  /**
   * Asks the provider for each past season the filter names and writes the
   * answers. `{ error }` when no provider serves it or a run is already open.
   */
  async run(
    filter: AbsenceHistoryFilter,
    onLine?: (line: AbsenceSeasonLine) => void,
    now: Date = new Date(),
  ): Promise<AbsenceHistorySweep | { error: string }> {
    // The provider that answers availability before a match (T-103) is the one asked.
    const source = this.sources.forJob('lineups');
    if (source === null) {
      return { error: this.sources.reason ?? 'no provider serves absences' };
    }
    const scope = [
      filter.competitionExternalId === null ? null : `competition ${filter.competitionExternalId}`,
      filter.seasonLabel ?? 'past seasons',
    ]
      .filter((part): part is string => part !== null)
      .join(' ');
    const shares = parseTierShares(process.env);
    try {
      return await this.runs.track(source.provider, ABSENCE_HISTORY_JOB, scope, async () => {
        const sweep = await sweepAbsenceHistory({
          provider: source.provider,
          adapter: source.adapter,
          store: this.store,
          filter,
          budget: this.sources.dailyBudget ?? null,
          bulkPercent: 'error' in shares ? DEFAULT_TIER_SHARES.bulk : shares.bulk,
          requestsToday: await this.runs.requestsToday(source.provider, now),
          // Spaced where the plan is held to a budget; not against a replay.
          pacer: this.sources.dailyBudget === undefined ? new AskPacer(0) : new AskPacer(),
          ...(onLine === undefined ? {} : { onLine }),
        });
        const totals = absenceHistoryTotals(sweep.lines);
        const refused = sweep.lines
          .filter((line) => line.outcome === 'refused')
          .map((line) => `${line.competitionExternalId} ${line.season}: ${line.note ?? ''}`);
        const partial = [...refused, ...(sweep.stopped === undefined ? [] : [sweep.stopped])].join(
          '; ',
        );
        this.log.log('absence history', {
          event: 'ingest.absence_history',
          provider: source.provider,
          asked: sweep.asked,
          seasons: totals.seasons,
          written: totals.written,
          skipped: totals.skipped,
          persons_unmapped: totals.personsUnmapped,
          relinked: sweep.relinked,
        });
        return {
          result: sweep,
          itemsSeen: totals.entries,
          itemsWritten: totals.written + sweep.relinked,
          ...(partial === '' ? {} : { partial }),
        };
      });
    } catch (error: unknown) {
      if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
        return { error: 'a run of the absence history is already open' };
      }
      throw error;
    }
  }
}
