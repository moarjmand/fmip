import { Inject, Injectable, Logger } from '@nestjs/common';
import { Pool } from 'pg';
import type { CoverageModule, CoverageState } from '@fmip/contracts';
import { PG_POOL } from '../../database/database.module';
import { COVERAGE_MODULES, compute } from './internal/coverage-rules';
import { CoverageStore } from './internal/coverage-store';

export { COVERAGE_MODULES, compute, type Computed, type Evidence } from './internal/coverage-rules';

export interface CoverageReport {
  seasonId: string;
  /** The state now recorded for each module. */
  states: Record<CoverageModule, CoverageState>;
  /** When each module's data last changed; absent for a module with no data. */
  freshness: Partial<Record<CoverageModule, string>>;
  /** Rows that actually changed. Zero when nothing moved since the last run. */
  changed: number;
}

/**
 * Coverage profile computation and freshness (T-027).
 *
 * Every module the API returns is wrapped in `Covered` and reads its state from
 * `coverage_profile` (T-012). Until now those rows were written by hand, which
 * makes the state a promise rather than a fact — and a promise is exactly what
 * rule 3 forbids: a season declared `available` whose line-ups never arrived
 * would show an empty module that looks populated.
 *
 * This recomputes each row from the rows that exist. The question asked per
 * module is always the same — of the fixtures that should carry it by now, how
 * many do — and the answer is `available`, `limited` or `not_supplied` with a
 * note saying the counts. `delayed` is the exception: it describes a provider's
 * behaviour, not our rows, so an admin's `delayed` survives a run that found
 * nothing, and is replaced as soon as data does arrive.
 *
 * It is deliberately not a sixth ingest job. Nothing here talks to a provider;
 * it reads what the five jobs wrote, so it runs at the end of the jobs that can
 * change an answer, and its writes are counted in that run.
 */
@Injectable()
export class CoverageService {
  private readonly log = new Logger('Ingestion');
  private readonly store: CoverageStore;

  constructor(@Inject(PG_POOL) pool: Pool) {
    this.store = new CoverageStore(pool);
  }

  /** Recomputes every module of one season. Writes only what changed. */
  async recompute(seasonId: string): Promise<CoverageReport> {
    const supplier = await this.store.supplier(seasonId);
    const states = {} as Record<CoverageModule, CoverageState>;
    let changed = 0;

    for (const module of COVERAGE_MODULES) {
      const [evidence, declared] = await Promise.all([
        this.store.evidence(seasonId, module),
        this.store.declared(seasonId, module),
      ]);
      const { state, note } = compute(module, evidence, declared);
      // `coverage_profile` insists that supplied data names where it came from,
      // and we will not name a provider we cannot evidence: if the season's
      // fixtures came from more than one, or from none, the module reports
      // `not_supplied` rather than claiming a source.
      const provider = state === 'not_supplied' ? null : supplier;
      const honest: CoverageState = provider === null ? 'not_supplied' : state;
      const reason =
        honest === state
          ? note
          : `${note} No single provider can be named for this season's fixtures.`;

      states[module] = honest;
      changed += await this.store.upsert(seasonId, module, honest, provider, reason);
    }

    const report: CoverageReport = {
      seasonId,
      states,
      freshness: await this.store.freshness(seasonId),
      changed,
    };
    if (changed > 0) {
      this.log.log(`coverage recomputed for season ${seasonId}`, {
        event: 'ingest.coverage_changed',
        season_id: seasonId,
        changed,
        states,
      });
    }
    return report;
  }

  /** Recomputes several seasons. Used by the jobs for whatever they touched. */
  async recomputeMany(seasonIds: readonly string[]): Promise<number> {
    let changed = 0;
    for (const seasonId of new Set(seasonIds)) {
      changed += (await this.recompute(seasonId)).changed;
    }
    return changed;
  }

  /** The seasons a set of fixtures belongs to, for a job that worked by fixture. */
  seasonsOf(fixtureIds: string[]): Promise<string[]> {
    return this.store.seasonsOf(fixtureIds);
  }

  /** When each module of a season last changed. */
  freshness(seasonId: string): Promise<Partial<Record<CoverageModule, string>>> {
    return this.store.freshness(seasonId);
  }
}
