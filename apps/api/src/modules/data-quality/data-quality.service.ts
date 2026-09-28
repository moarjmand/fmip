import { Injectable, Logger } from '@nestjs/common';
import {
  type Finding,
  SWEPT_CHECKS,
  type TableComparison,
  duplicateFixture,
  finishedWithoutScore,
  fixtureMappedTwice,
  goalsDisagree,
  lineupNotEleven,
  liveOverrun,
  tableDisagreements,
} from './internal/checks';
import { type CheckRows, DataQualityStore, type WriteOutcome } from './internal/data-quality-store';

export type { TableComparison } from './internal/checks';

/** Rows to findings for every swept check. Pure; exported for the unit tests. */
export function findingsOf(rows: CheckRows, now: Date): Finding[] {
  const out: (Finding | null)[] = [
    ...rows.scores.map(finishedWithoutScore),
    ...rows.goals.map(goalsDisagree),
    ...rows.live.map((row) => liveOverrun(row, now)),
    ...rows.lineups.map(lineupNotEleven),
    ...rows.mappings.map(fixtureMappedTwice),
    ...rows.pairs.map(duplicateFixture),
  ];
  // One subject per check: a pair read twice, or a line-up read per row, is one finding.
  const unique = new Map<string, Finding>();
  for (const finding of out) {
    if (finding !== null) unique.set(`${finding.check}|${finding.subjectKey}`, finding);
  }
  return [...unique.values()];
}

/**
 * Data-quality checks over the stored feed (T-820, D-097). Public surface:
 *
 * - `sweep()`: every check over the stored data, on the `data-quality`
 *   schedule. Reads first, outside a transaction; then records the findings
 *   and resolves the ones no longer found, under one lock.
 * - `recordTable()`: the standings job's comparison of the provider's table
 *   with ours, which is the one check that needs the provider's answer -- so
 *   it rides on the request that job already makes, never a new one.
 *
 * Nothing here corrects data. A finding names the fixture and the check.
 */
@Injectable()
export class DataQualityService {
  private readonly log = new Logger('DataQuality');

  constructor(private readonly store: DataQualityStore) {}

  async sweep(now: Date = new Date()): Promise<WriteOutcome & { findings: number }> {
    const rows = await this.store.read(now);
    const findings = findingsOf(rows, now);
    const outcome = await this.store.locked((client) =>
      this.store.record(client, SWEPT_CHECKS, null, findings, now),
    );
    if (outcome.opened > 0 || outcome.resolved > 0) {
      this.log.log(
        `data quality: ${outcome.opened} opened, ${outcome.resolved} resolved, ${findings.length} open`,
        { event: 'data_quality.swept', ...outcome, findings: findings.length },
      );
    }
    return { ...outcome, findings: findings.length };
  }

  /** One season's table comparison from the standings job (T-030) as findings. */
  async recordTable(
    seasonId: string,
    comparisons: readonly TableComparison[],
    unmapped: number,
    now: Date = new Date(),
  ): Promise<WriteOutcome | null> {
    const competitionId = await this.store.competitionOf(seasonId);
    if (competitionId === null) return null;
    const findings = tableDisagreements({ seasonId, competitionId }, comparisons, unmapped);
    return this.store.locked((client) =>
      this.store.record(client, ['table_disagrees'], seasonId, findings, now),
    );
  }
}
