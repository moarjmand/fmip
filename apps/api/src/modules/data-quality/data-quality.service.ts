import { Injectable, Logger } from '@nestjs/common';
import {
  DATA_QUALITY_CHECKS,
  type DataQualityCheck,
  type DataQualityFinding,
  type DataQualityFixtureRef,
  type DataQualityReport,
} from '@fmip/contracts';
import {
  type Finding,
  LIVE_HORIZON_MINUTES,
  LIVE_MIN_AGE_MINUTES,
  SWEPT_CHECKS,
  checkFreshness,
  type TableComparison,
  duplicateFixture,
  finishedWithoutScore,
  fixtureMappedTwice,
  goalsDisagree,
  lineupNotEleven,
  liveOverrun,
  tableDisagreements,
} from './internal/checks';
import {
  type CheckRows,
  DataQualityStore,
  type FindingRow,
  type ReviewOutcome,
  type WriteOutcome,
} from './internal/data-quality-store';
import { coverageProposal } from './internal/coverage-proposals';

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
 *   schedule, or over one season's for a test. Reads first, outside a
 *   transaction; then records the findings and resolves the ones no longer
 *   found, under one lock.
 * - `recordTable()`: the standings job's comparison of the provider's table
 *   with ours, which is the one check that needs the provider's answer -- so
 *   it rides on the request that job already makes, never a new one.
 * - `report()` and `review()`: the admin page (T-821); `reviewBatch()`
 *   (T-912). The report proposes past seasons' `lineups` / `incidents`
 *   coverage as `limited` where D-109's conditions hold (T-914); an
 *   administrator applies a proposal through the audited coverage write.
 * - `requestRefetch()`: an administrator asks the feed again (T-913, D-110);
 *   `refetchesDue()`, `recordRefetch()` and `refetchedSince()` are how the
 *   post-match job carries that queue within its share of the budget.
 * - `liveContradictions()`: what the watchdog's `data_quality` condition reads.
 *
 * Nothing here corrects data. A finding names the fixture and the check.
 */
@Injectable()
export class DataQualityService {
  private readonly log = new Logger('DataQuality');

  constructor(private readonly store: DataQualityStore) {}

  /**
   * `seasonId` narrows the sweep to one season: it reads only that season's
   * fixtures and resolves only that season's findings. The schedule never
   * passes one; a test does, so it judges its own fixtures and not the rows
   * suites running beside it are writing and deleting.
   */
  async sweep(
    now: Date = new Date(),
    seasonId: string | null = null,
  ): Promise<WriteOutcome & { findings: number }> {
    const rows = await this.store.read(now, seasonId);
    const findings = findingsOf(rows, now);
    const outcome = await this.store.locked((client) =>
      this.store.record(client, SWEPT_CHECKS, seasonId, findings, now),
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

  /** `GET /admin/data-quality` (T-821): each check's last run, counts, and the open findings. */
  async report(now: Date = new Date()): Promise<DataQualityReport> {
    const [runs, counts, findings, resolved, refetch, candidates] = await Promise.all([
      this.store.checkRuns(),
      this.store.counts(),
      this.store.openFindings(REPORT_FINDINGS),
      this.store.resolvedSince(new Date(now.getTime() - DAY_MS)),
      this.store.refetchCounts(utcDayStart(now)),
      this.store.coverageCandidates(),
    ]);
    const openByCheck = new Map<string, number>();
    for (const c of counts)
      openByCheck.set(c.check_kind, (openByCheck.get(c.check_kind) ?? 0) + c.open);
    return {
      generated_at: now.toISOString(),
      checks: DATA_QUALITY_CHECKS.map((check) => {
        const at = runs.get(check) ?? null;
        return {
          check,
          checked_at: at === null ? null : at.toISOString(),
          freshness: checkFreshness(check, at, now),
          open: openByCheck.get(check) ?? 0,
        };
      }),
      counts: counts.map((c) => ({
        competition:
          c.competition_id === null
            ? null
            : { id: c.competition_id, name: c.competition_name ?? '' },
        season: c.season_id === null ? null : { id: c.season_id, label: c.season_label ?? '' },
        check: c.check_kind,
        open: c.open,
        reviewed: c.reviewed,
      })),
      findings: findings.map(findingOf),
      open_total: counts.reduce((sum, c) => sum + c.open, 0),
      resolved_last_day: resolved,
      refetch: { pending: refetch.pending, fetched_today: refetch.fetched },
      coverage_proposals: candidates
        .map(coverageProposal)
        .filter((p): p is NonNullable<typeof p> => p !== null),
    };
  }

  /** Marks an open finding reviewed with a reason; the audit row is written in the same transaction. */
  review(
    id: number,
    actorId: string,
    reason: string,
    now: Date = new Date(),
  ): Promise<ReviewOutcome> {
    return this.store.review(id, actorId, reason, now);
  }

  /**
   * Marks every open, unreviewed finding of one check in one season reviewed
   * with one reason, audited as one batch (T-912). Returns how many.
   */
  reviewBatch(
    check: DataQualityCheck,
    seasonId: string,
    actorId: string,
    reason: string,
    now: Date = new Date(),
  ): Promise<number> {
    return this.store.reviewBatch(check, seasonId, actorId, reason, now);
  }

  /**
   * Queues a re-ask of the feed for one fixture, or for every fixture behind
   * one check's open findings in one season, audited with the reason (T-913).
   * `null`: no such fixture, or nothing in that class the feed can be asked
   * about.
   */
  requestRefetch(
    target: { fixtureId: string } | { check: DataQualityCheck; seasonId: string },
    actorId: string,
    reason: string,
    now: Date = new Date(),
  ): Promise<{ queued: string[]; alreadyQueued: number } | null> {
    return this.store.requestRefetch(target, actorId, reason, now);
  }

  /** The post-match job's next re-asks: waiting, in these competitions, with this provider's id. */
  refetchesDue(
    provider: string,
    competitionIds: readonly string[],
    limit: number,
  ): Promise<{ id: string; fixtureId: string; externalId: string; competitionId: string }[]> {
    return this.store.refetchesDue(provider, competitionIds, limit);
  }

  /** The job asked the feed for a queued fixture; `changed` is whether the answer changed a stored row. */
  recordRefetch(id: string, changed: boolean): Promise<void> {
    return this.store.recordRefetch(id, changed);
  }

  /** Re-asks the job carried since 00:00 UTC of `now`'s day: the share already spent. */
  async refetchedSince(now: Date = new Date()): Promise<number> {
    return (await this.store.refetchCounts(utcDayStart(now))).fetched;
  }

  /**
   * What the watchdog's `data_quality` condition reads (T-821, D-097): open,
   * unreviewed findings about a match live or kicked off in the last six
   * hours, open for ten minutes or more; and the oldest of the swept checks'
   * newest runs, so a sweep that stopped reads as not known rather than fine.
   */
  async liveContradictions(
    now: Date = new Date(),
  ): Promise<{ open: number; sweptAt: Date | null }> {
    const [runs, open] = await Promise.all([
      this.store.checkRuns(),
      this.store.liveContradictions(
        new Date(now.getTime() - LIVE_HORIZON_MINUTES * 60_000),
        new Date(now.getTime() - LIVE_MIN_AGE_MINUTES * 60_000),
      ),
    ]);
    let sweptAt: Date | null = null;
    for (const check of SWEPT_CHECKS) {
      const at = runs.get(check);
      if (at === undefined) return { open, sweptAt: null };
      if (sweptAt === null || at < sweptAt) sweptAt = at;
    }
    return { open, sweptAt };
  }
}

const REPORT_FINDINGS = 200;
const DAY_MS = 24 * 60 * 60 * 1000;

function utcDayStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function iso(value: string | null): string | null {
  return value === null ? null : new Date(value).toISOString();
}

function fixtureOf(json: FindingRow['fixture']): DataQualityFixtureRef | null {
  if (json === null) return null;
  return { ...json, kickoff_at: new Date(json.kickoff_at).toISOString() };
}

function findingOf(row: FindingRow): DataQualityFinding {
  return {
    id: Number(row.id),
    check: row.check_kind,
    detail: row.detail,
    competition:
      row.competition_id === null
        ? null
        : { id: row.competition_id, name: row.competition_name ?? '' },
    season: row.season_id === null ? null : { id: row.season_id, label: row.season_label ?? '' },
    fixture: fixtureOf(row.fixture),
    related_fixture: fixtureOf(row.related_fixture),
    team: row.team_id === null ? null : { id: row.team_id, name: row.team_name ?? '' },
    first_seen_at: row.first_seen_at.toISOString(),
    last_seen_at: row.last_seen_at.toISOString(),
    reviewed:
      row.reviewed_at === null
        ? null
        : {
            at: row.reviewed_at.toISOString(),
            by: row.reviewed_by,
            reason: row.review_reason ?? '',
          },
    asked_again:
      row.asked_again === null
        ? null
        : {
            requested_at: iso(row.asked_again.requested_at) ?? '',
            fetched_at: iso(row.asked_again.fetched_at),
            changed: row.asked_again.changed,
          },
  };
}
